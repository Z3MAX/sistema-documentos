const SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL;

async function postToScript(payload) {
  const response = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload),
    redirect: 'follow',
  });
  const text = await response.text();
  console.log('Resposta Apps Script:', text.substring(0, 400));
  return JSON.parse(text);
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

    // 1ª chamada — CNH
    const data = await postToScript({
      nome,
      email,
      arquivo,
      nomeArquivo,
      mimeType: mimeType || 'application/octet-stream',
    });

    if (!data || data.success !== true) {
      return { statusCode: 500, headers, body: JSON.stringify(data || { error: 'Erro ao enviar CNH.' }) };
    }

    // 2ª chamada — Histórico da CNH (separada para evitar payload grande)
    if (arquivoHistorico && nomeArquivoHistorico) {
      console.log('Enviando histórico ao Apps Script...');
      try {
        await postToScript({
          nome,
          email,
          arquivo: arquivoHistorico,
          nomeArquivo: `HISTORICO_${nomeArquivoHistorico}`,
          mimeType: mimeTypeHistorico || 'application/octet-stream',
        });
        console.log('Histórico enviado com sucesso.');
      } catch (histErr) {
        console.error('Erro ao enviar histórico:', histErr.message);
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error('Erro no proxy:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erro ao processar o envio.' }) };
  }
};
