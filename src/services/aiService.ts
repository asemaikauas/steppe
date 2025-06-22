import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY as string);

export interface ProcessedContent {
    summary: string;
    keyPoints: string[];
    script: string;
    tags: string[];
}

export class AIService {
    private model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
        generationConfig: { "responseMimeType": "application/json" }
    });

    async processArticle(title: string, content: string): Promise<ProcessedContent> {
        try {
            console.log('Processing article with AI...');

            const prompt = `
        Проанализируй эту статью с The Steppe и создай контент для TikTok видео:
        
        Заголовок: ${title}
        Текст: ${content}
        
        Верни JSON в следующем формате:
        {
          "summary": "краткое изложение статьи (2-3 предложения, БЕЗ эмодзи)",
          "keyPoints": ["ключевая мысль 1", "ключевая мысль 2", "ключевая мысль 3"],
          "script": "сценарий для TikTok видео - четкий текст БЕЗ эмодзи, подходящий для субтитров",
          "tags": ["тег1", "тег2", "тег3", "тег4", "тег5"]
        }
        
        ВАЖНО для сценария:
        - БЕЗ эмодзи и специальных символов
        - Четкие короткие предложения
        - Подходящий для отображения в субтитрах
        - Длительностью 30-60 секунд при чтении
        - Адаптированный для казахстанской аудитории
        - Динамичный и информативный
      `;

            const result = await this.model.generateContent(prompt);
            const response = result.response;
            const text = response.text();

            console.log('AI processing completed');
            return JSON.parse(text);

        } catch (error: any) {
            console.error('AI Service error:', error);
            throw new Error(`AI processing failed: ${error.message}`);
        }
    }

    async generateVideoMetadata(content: ProcessedContent): Promise<{
        title: string;
        description: string;
        hashtags: string;
    }> {
        try {
            const prompt = `
        На основе обработанного контента создай метаданные для TikTok видео:
        
        Контент: ${JSON.stringify(content)}
        
        Верни JSON:
        {
          "title": "цепляющий заголовок для TikTok (до 100 символов)",
          "description": "описание видео (до 300 символов)",
          "hashtags": "хештеги через пробел (до 10 штук)"
        }
      `;

            const result = await this.model.generateContent(prompt);
            const response = result.response;
            const text = response.text();

            return JSON.parse(text);

        } catch (error: any) {
            console.error('Metadata generation error:', error);
            throw new Error(`Metadata generation failed: ${error.message}`);
        }
    }
} 