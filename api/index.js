require('dotenv').config();
const express = require('express');
const { MessagingResponse } = require('twilio').twiml;
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.urlencoded({ extended: true }));

// ConfiguraciÃ³n de Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: 'gemini-flash-latest',
    systemInstruction: `Eres un asistente virtual avanzado en WhatsApp. Eres amigable, Ãºtil y directo.
Si el usuario te pide que generes, dibujes, crees o imagines una imagen/foto, DEBES incluir en tu respuesta la siguiente etiqueta exacta:
[IMAGE: <descripcion detallada en ingles de lo que quieres generar>]

Ejemplo de respuesta si el usuario pide un perro:
Â¡Claro! AquÃ­ tienes la imagen de un perro lindo:
[IMAGE: A cute fluffy golden retriever puppy playing in a sunny green park, highly detailed, 4k]

Siempre debes describir la imagen en INGLÃ‰S dentro de la etiqueta [IMAGE: ...].`
});

// Almacenar el historial bÃ¡sico de conversaciÃ³n en memoria (solo para pruebas)
const chatHistory = new Map();

app.post('/api/webhook', async (req, res) => {
    const incomingText = req.body.Body ? req.body.Body.trim() : "";
    const sender = req.body.From;
    const mediaUrl = req.body.MediaUrl0;
    const mediaType = req.body.MediaContentType0;

    console.log(`Mensaje recibido de ${sender}: texto='${incomingText}' media='${mediaUrl}' type='${mediaType}'`);

    const twiml = new MessagingResponse();
    const message = twiml.message();

    try {
        // Ignorar mensajes completamente vacÃ­os (sin texto y sin media)
        if (!incomingText && !mediaUrl) {
            console.log("Mensaje vacÃ­o ignorado.");
            res.writeHead(200, { 'Content-Type': 'text/xml' });
            return res.end(twiml.toString());
        }

        // Iniciar chat si no existe
        if (!chatHistory.has(sender)) {
            chatHistory.set(sender, model.startChat({ history: [] }));
        }

        const chat = chatHistory.get(sender);
        
        // Preparar el mensaje para Gemini
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
        } else if (mediaUrl && mediaType.startsWith('audio/')) {
            // Si es solo audio sin texto, decirle a Gemini que escuche
            geminiInput.push("Escucha atentamente este audio y responde acorde a lo que digo.");
        } else if (mediaUrl && mediaType.startsWith('image/')) {
            geminiInput.push("Describe o analiza esta imagen.");
        }

        // Enviar mensaje a Gemini
        const result = await chat.sendMessage(geminiInput);
        const responseText = result.response.text();

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
        // Si la conversaciÃ³n se corrompiÃ³ o hubo un error crÃ­tico, reiniciarla.
        chatHistory.delete(sender);
        message.body('Lo siento, tuve un problema interno al procesar tu solicitud, pero ya he reiniciado mi sistema. Por favor, vuelve a intentarlo. ðŸ”„');
    }

    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());
});

app.get('/api', (req, res) => {
    res.send('El servidor de WhatsApp AI Assistant estÃ¡ funcionando correctamente con soporte de Audio.');
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
