const SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL;

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
    // Netlify pode codificar o body em base64 para payloads binários/grandes
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

    console.log('Campos OK:', nome, '|', email, '|', nomeArquivo, '| arquivo len:', arquivo.length);
    console.log('arquivoHistorico presente:', !!arquivoHistorico, '| nomeArquivoHistorico:', nomeArquivoHistorico || 'VAZIO');
    if (arquivoHistorico) console.log('Histórico len:', arquivoHistorico.length);

    // Re-serializar garante JSON limpo sem nenhum byte extra
    const payload = JSON.stringify({
      nome,
      email,
      arquivo,
      nomeArquivo,
      mimeType: mimeType || 'application/octet-stream',
      ...(arquivoHistorico && {
        arquivoHistorico,
        nomeArquivoHistorico,
        mimeTypeHistorico: mimeTypeHistorico || 'application/octet-stream',
      }),
    });

    // redirect: 'follow' deixa o fetch seguir o redirect 302 do Apps Script automaticamente
    // (o Apps Script já processou o POST antes de redirecionar, então o GET no echo URL funciona)
    const response = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: payload,
    });

    console.log('Status final:', response.status, '| URL final:', response.url);

    const text = await response.text();
    console.log('Resposta Apps Script:', text.substring(0, 400));

    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      console.error('JSON inválido — texto recebido:', text.substring(0, 500));
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Resposta inesperada do servidor.' }) };
    }

    const isSuccess = data && data.success === true;
    return { statusCode: isSuccess ? 200 : 500, headers, body: JSON.stringify(data) };

  } catch (err) {
    console.error('Erro no proxy:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erro ao processar o envio.' }) };
  }
};
