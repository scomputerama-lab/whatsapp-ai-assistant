require('dotenv').config();
const express = require('express');
const { MessagingResponse } = require('twilio').twiml;
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.urlencoded({ extended: true }));

// ConfiguraciÃ³n de Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: 'gemini-1.5-pro',
    systemInstruction: `Eres un asistente virtual avanzado en WhatsApp. Eres amigable, Ãºtil y directo.
Si el usuario te pide que generes, dibujes, crees o imagines una imagen/foto, DEBES incluir en tu respuesta la siguiente etiqueta exacta:
[IMAGE: <descripcion detallada en ingles de lo que quieres generar>]

Ejemplo de respuesta si el usuario pide un perro:
Â¡Claro! AquÃ­ tienes la imagen de un perro lindo:
[IMAGE: A cute fluffy golden retriever puppy playing in a sunny green park, highly detailed, 4k]

Siempre debes describir la imagen en INGLÃ‰S dentro de la etiqueta [IMAGE: ...], porque el generador de imÃ¡genes funciona mejor en inglÃ©s.`
});

// Almacenar el historial bÃ¡sico de conversaciÃ³n en memoria (solo para pruebas)
const chatHistory = new Map();

app.post('/api/webhook', async (req, res) => {
    const incomingMessage = req.body.Body;
    const sender = req.body.From;

    console.log(`Mensaje recibido de ${sender}: ${incomingMessage}`);

    const twiml = new MessagingResponse();
    const message = twiml.message();

    try {
        // Iniciar chat si no existe
        if (!chatHistory.has(sender)) {
            chatHistory.set(sender, model.startChat({ history: [] }));
        }

        const chat = chatHistory.get(sender);
        
        // Enviar mensaje a Gemini
        const result = await chat.sendMessage(incomingMessage);
        const responseText = result.response.text();

        // Buscar si Gemini decidiÃ³ generar una imagen
        const imageRegex = /\[IMAGE:\s*(.*?)\]/i;
        const match = responseText.match(imageRegex);

        let finalResponse = responseText;

        if (match && match[1]) {
            const imagePrompt = match[1];
            // Remover la etiqueta del texto final
            finalResponse = finalResponse.replace(imageRegex, '').trim();
            
            // Generar URL de Pollinations.ai
            const encodedPrompt = encodeURIComponent(imagePrompt);
            const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?nologo=true&width=1024&height=1024`;
            
            console.log(`Generando imagen con URL: ${imageUrl}`);
            message.media(imageUrl);
        }

        message.body(finalResponse || "Â¡AquÃ­ tienes tu imagen!");

    } catch (error) {
        console.error('Error procesando mensaje:', error);
        message.body('Lo siento, tuve un problema interno al procesar tu solicitud. ðŸ˜¢');
    }

    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());
});

app.get('/api', (req, res) => {
    res.send('El servidor de WhatsApp AI Assistant estÃ¡ funcionando correctamente.');
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
