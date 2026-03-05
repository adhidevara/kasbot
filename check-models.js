// check-models.js
import 'dotenv/config';
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function listAvailableModels() {
    try {
        console.log("🔍 Mengecek daftar model untuk API Key Anda...");
        // Kita gunakan fetch manual karena method listModels terkadang berbeda versi
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
        const data = await response.json();

        if (data.error) {
            console.error("❌ Error dari Google:", data.error.message);
            return;
        }

        console.log("✅ Model yang tersedia untuk Anda:");
        data.models.forEach(m => {
            console.log(`- ${m.name} (Support: ${m.supportedGenerationMethods.join(', ')})`);
        });
    } catch (err) {
        console.error("❌ Gagal mengambil daftar model:", err.message);
    }
}

listAvailableModels();