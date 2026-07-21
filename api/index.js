require('dotenv').config();
const express = require('express');
const { MessagingResponse } = require('twilio').twiml;
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.urlencoded({ extended: true }));

// ConfiguraciÃ³n de Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: 'gemini-2.5-flash',
    generationConfig: {
        maxOutputTokens: 300, // Limitar a ~250 palabras para ser ultra rÃ¡pido y no dar Timeout en Twilio
    },
    systemInstruction: `Eres un asistente virtual avanzado en WhatsApp. Eres amigable y sumamente DIRECTO.
Tus respuestas deben ser CORTAS Y CONCISAS (mÃ¡ximo 2 o 3 pÃ¡rrafos cortos). NUNCA des respuestas largas porque el servidor cortarÃ¡ la conexiÃ³n por lÃ­mite de tiempo.
Si el usuario te pide una receta o explicaciÃ³n, dÃ¡sela resumida y ve directo al grano.
Si el usuario te pide que generes, dibujes, crees o imagines una imagen/foto, DEBES incluir en tu respuesta la siguiente etiqueta exacta:
[IMAGE: <descripcion detallada en ingles de lo que quieres generar>]

Ejemplo de respuesta si el usuario pide un perro:
Â¡Claro! AquÃ­ tienes la imagen de un perro lindo:
[IMAGE: A cute fluffy golden retriever puppy playing in a sunny green park, highly detailed, 4k]

Siempre debes describir la imagen en INGLÃ‰S dentro de la etiqueta [IMAGE: ...].`
});

// Almacenar el historial bÃ¡sico de conversaciÃ³n en memoria (solo para pruebas)
const chatHistory = new Map();

// Capturar cualquier ruta y cualquier mÃ©todo (GET/POST) para evitar errores si el usuario pegÃ³ mal la URL en Twilio
app.use(async (req, res) => {
    const incomingText = req.body.Body ? req.body.Body.trim() : "";
    const sender = req.body.From;
    const mediaUrl = req.body.MediaUrl0;
    const mediaType = req.body.MediaContentType0;

    console.log(`Mensaje recibido de ${sender}: texto='${incomingText}' media='${mediaUrl}' type='${mediaType}'`);

    const twiml = new MessagingResponse();
    const message = twiml.message();

    // Si es un GET simple (ping) y no viene de WhatsApp
    if (!sender && req.method === 'GET') {
        return res.send('El servidor de WhatsApp AI Assistant estÃ¡ funcionando correctamente. Twilio debe apuntar aquÃ­ por POST.');
    }

    try {
        // Ignorar mensajes completamente vacÃ­os (sin texto y sin media)
        if (!incomingText && !mediaUrl) {
            console.log("Mensaje vacÃ­o ignorado.");
            res.writeHead(200, { 'Content-Type': 'text/xml' });
            return res.end(twiml.toString());
        }

        // Preparar el mensaje para Gemini (Completamente Stateless para evitar bloqueos en Vercel)
        let geminiInput = [];
        
        // Si hay archivo multimedia (Audio, Imagen, etc)
        if (mediaUrl) {
            try {
                console.log(`Descargando archivo desde: ${mediaUrl}`);
                const mediaResponse = await fetch(mediaUrl);
                const arrayBuffer = await mediaResponse.arrayBuffer();
                const base64Data = Buffer.from(arrayBuffer).toString('base64');
                
                geminiInput.push({
                    inlineData: {
                        data: base64Data,
                        mimeType: mediaType
                    }
                });
            } catch (mediaError) {
                console.error("Error descargando media:", mediaError);
                message.body("Lo siento, no pude procesar tu archivo adjunto o nota de voz. ðŸ˜¢");
                res.writeHead(200, { 'Content-Type': 'text/xml' });
                return res.end(twiml.toString());
            }
        }

        if (incomingText) {
            geminiInput.push(incomingText);
        } else if (mediaUrl && mediaType && mediaType.startsWith('audio/')) {
            geminiInput.push("Escucha atentamente este audio y responde acorde a lo que digo.");
        } else if (mediaUrl && mediaType && mediaType.startsWith('image/')) {
            geminiInput.push("Describe o analiza esta imagen.");
        } else {
            geminiInput.push("Analiza este archivo.");
        }

        console.log("Enviando a Gemini...");
        // Usar generateContent en lugar de startChat para evitar sockets colgados en Serverless
        const result = await model.generateContent(geminiInput);
        const responseText = result.response.text();
        console.log("Respuesta recibida de Gemini.");

        // Buscar si Gemini decidiÃ³ generar una imagen
        const imageRegex = /\[IMAGE:\s*(.*?)\]/i;
        const match = responseText.match(imageRegex);

        let finalResponse = responseText;

        if (match && match[1]) {
            const imagePrompt = match[1];
            finalResponse = finalResponse.replace(imageRegex, '').trim();
            
            const encodedPrompt = encodeURIComponent(imagePrompt);
            const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?nologo=true&width=1024&height=1024`;
            
            console.log(`Generando imagen con URL: ${imageUrl}`);
            message.media(imageUrl);
        }

        message.body(finalResponse || "Â¡AquÃ­ tienes tu imagen!");

    } catch (error) {
        console.error('Error procesando mensaje:', error);
        message.body('Lo siento, tuve un problema: ' + error.message);
    }

    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());
});

// Exportar la aplicaciÃ³n para Vercel
module.exports = app;

// Iniciar el servidor si se ejecuta localmente
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Servidor local corriendo en el puerto ${PORT}`);
    });
}
