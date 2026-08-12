const SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function postToScriptOnce(payload) {
  const response = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload),
    redirect: 'follow',
  });
  const text = await response.text();
  const trimmed = text.trim();

  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    console.error('Resposta não-JSON do Apps Script:', trimmed.substring(0, 400));
    throw new Error('Resposta inesperada do Apps Script (não é JSON).');
  }

  console.log('Resposta Apps Script:', trimmed.substring(0, 400));
  return JSON.parse(trimmed);
}

// O Apps Script ocasionalmente devolve uma página de erro HTML do Google
// em vez do JSON esperado (falha transitória do lado do Google). Tenta
// novamente antes de desistir.
async function postToScript(payload, retries = 2, baseDelayMs = 1000) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await postToScriptOnce(payload);
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`Tentativa ${attempt + 1} falhou (${err.message}), tentando novamente...`);
      await sleep(baseDelayMs * (attempt + 1));
    }
  }
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido.' }) };

  if (!SCRIPT_URL) {
    console.error('GOOGLE_APPS_SCRIPT_URL não configurada');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Configuração do servidor incorreta.' }) };
  }

  try {
    let rawBody = event.body;
    if (event.isBase64Encoded) {
      rawBody = Buffer.from(event.body, 'base64').toString('utf8');
    }

    const parsed = JSON.parse(rawBody);
    const { nome, email, arquivo, nomeArquivo, mimeType,
            arquivoHistorico, nomeArquivoHistorico, mimeTypeHistorico } = parsed;

    if (!nome || !email || !arquivo || !nomeArquivo) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Campos obrigatórios faltando.' }) };
    }

    console.log('CNH:', nomeArquivo, '| len:', arquivo.length);
    console.log('Histórico presente:', !!arquivoHistorico, '|', nomeArquivoHistorico || 'nenhum');

    const temHistorico = !!(arquivoHistorico && nomeArquivoHistorico);

    // CNH e Histórico são enviados em paralelo (chamadas separadas ao Apps
    // Script para evitar payload único grande) para reduzir a duração total
    // da function e a chance de esbarrar em falhas transitórias do Google.
    const [cnhResult, histResult] = await Promise.allSettled([
      postToScript({
        nome,
        email,
        arquivo,
        nomeArquivo,
        mimeType: mimeType || 'application/octet-stream',
      }),
      temHistorico
        ? postToScript({
            nome,
            email,
            arquivo: arquivoHistorico,
            nomeArquivo: `HISTORICO_${nomeArquivoHistorico}`,
            mimeType: mimeTypeHistorico || 'application/octet-stream',
          })
        : Promise.resolve(null),
    ]);

    if (cnhResult.status === 'rejected') {
      console.error('Erro ao enviar CNH:', cnhResult.reason.message);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erro ao enviar CNH.' }) };
    }
    if (!cnhResult.value || cnhResult.value.success !== true) {
      return { statusCode: 500, headers, body: JSON.stringify(cnhResult.value || { error: 'Erro ao enviar CNH.' }) };
    }

    if (temHistorico) {
      if (histResult.status === 'rejected') {
        console.error('Erro ao enviar histórico:', histResult.reason.message);
      } else {
        console.log('Histórico enviado com sucesso.');
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error('Erro no proxy:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erro ao processar o envio.' }) };
  }
};
