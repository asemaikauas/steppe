import express from 'express';
import { ArticleController } from '../controllers/articleController';
import { VoiceService } from '../services/voiceService';
import { VideoService } from '../services/videoService';
import { Request, Response } from 'express';

const router = express.Router();
const articleController = new ArticleController();
const voiceService = new VoiceService();

// POST /generate - принимает URL новости, помещает задачу в очередь
router.post('/generate', (req, res) => {
    articleController.generateVideo(req, res);
});

// GET /status/:jobId - возвращает статус генерации
router.get('/status/:jobId', (req, res) => {
    articleController.getJobStatus(req, res);
});

// GET /jobs - получить все задачи
router.get('/jobs', (req, res) => {
    articleController.getAllJobs(req, res);
});

// POST /regenerate/:jobId - принудительно пересоздать видео
router.post('/regenerate/:jobId', (req, res) => {
    articleController.regenerateVideo(req, res);
});

// POST /test-media - тестирование поиска медиа
router.post('/test-media', (req, res) => {
    articleController.testMediaSearch(req, res);
});

// POST /test-video - тестирование сборки видео
router.post('/test-video', (req, res) => {
    articleController.testVideoAssembly(req, res);
});

// POST /test-dynamic-video - тестирование динамических кадров
router.post('/test-dynamic-video', (req, res) => {
    articleController.testDynamicVideo(req, res);
});

// Тестовый endpoint для проверки синтеза речи
router.post('/test-voice', async (req, res) => {
    try {
        const { text } = req.body;

        if (!text) {
            return res.status(400).json({
                error: 'Text is required',
                message: 'Please provide text to synthesize'
            });
        }

        console.log('Testing voice synthesis...');

        const result = await voiceService.synthesizeSpeech(text, {
            voiceId: 'pNInz6obpgDQGcFmaJgB',
            stability: 0.7,
            similarityBoost: 0.8
        });

        if (result) {
            res.json({
                success: true,
                audioPath: result.audioPath,
                duration: result.duration,
                message: 'Voice synthesis completed successfully'
            });
        } else {
            res.status(500).json({
                error: 'Voice synthesis failed',
                message: 'Check your ElevenLabs API key and try again'
            });
        }

    } catch (error: any) {
        console.error('Test voice error:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

// Получить доступные голоса
router.get('/voices', async (req, res) => {
    try {
        const voices = await voiceService.getAvailableVoices();
        res.json({
            voices,
            count: voices.length
        });
    } catch (error: any) {
        console.error('Get voices error:', error);
        res.status(500).json({
            error: 'Failed to fetch voices',
            message: error.message
        });
    }
});

// Тестовый эндпоинт для субтитров
router.post('/test-subtitles', async (req: Request, res: Response) => {
    try {
        const { script } = req.body;

        if (!script) {
            return res.status(400).json({
                error: 'Missing required field',
                message: 'Please provide script'
            });
        }

        console.log('Testing subtitle generation...');

        const videoService = new VideoService();

        // Создаем временный ID для тестирования
        const testId = 'test-' + Date.now();

        // Вызываем приватный метод через рефлексию для тестирования
        const subtitlePath = await (videoService as any).generateSubtitles(script, testId);

        // Читаем содержимое файла
        const fs = require('fs');
        const subtitleContent = fs.readFileSync(subtitlePath, 'utf8');

        res.json({
            success: true,
            subtitlePath,
            content: subtitleContent,
            message: 'Subtitle generation completed successfully'
        });

    } catch (error: any) {
        console.error('Test subtitle generation error:', error);
        res.status(500).json({
            error: 'Subtitle generation failed',
            message: error.message
        });
    }
});

// Тестовый эндпоинт для полного пайплайна с водяным знаком
router.post('/test-full-pipeline', async (req: Request, res: Response) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({
                error: 'Missing required field',
                message: 'Please provide article URL'
            });
        }

        console.log('🚀 Testing full pipeline with STEPPE watermark...');

        const controller = new ArticleController();

        // Запускаем полный пайплайн
        const result = await controller.generateVideo(req, res);

        // Результат уже отправлен через res в контроллере

    } catch (error: any) {
        console.error('Test full pipeline error:', error);
        res.status(500).json({
            error: 'Full pipeline test failed',
            message: error.message
        });
    }
});

// Тестовый эндпоинт для демонстрации регенерации
router.post('/test-regeneration', async (req: Request, res: Response) => {
    try {
        const testUrl = 'https://the-steppe.com/gorod/issledovanie-dva-chasa-v-nedelyu-na-prirode-vedut-k-uluchsheniyu-zdorovya';

        console.log('🧪 Testing regeneration functionality...');

        // 1. Обычный запрос (должен показать предупреждение)
        console.log('1️⃣ Testing normal request...');

        // 2. Принудительная регенерация
        console.log('2️⃣ Testing force regeneration...');

        res.json({
            message: 'Regeneration test endpoints',
            examples: {
                normal: {
                    method: 'POST',
                    url: '/api/article/generate',
                    body: { url: testUrl },
                    description: 'Shows warning if job exists'
                },
                force: {
                    method: 'POST',
                    url: '/api/article/generate',
                    body: { url: testUrl, force: true },
                    description: 'Forces regeneration by deleting old job'
                },
                regenerateById: {
                    method: 'POST',
                    url: '/api/article/regenerate/:jobId',
                    description: 'Regenerates existing job by ID'
                }
            },
            testUrl: testUrl
        });

    } catch (error: any) {
        console.error('Test regeneration error:', error);
        res.status(500).json({
            error: 'Test failed',
            message: error.message
        });
    }
});

export default router; 