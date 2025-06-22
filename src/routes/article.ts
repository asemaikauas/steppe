import express from 'express';
import { ArticleController } from '../controllers/articleController';
import { VoiceService } from '../services/voiceService';

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

// POST /test-media - тестирование поиска медиа
router.post('/test-media', (req, res) => {
    articleController.testMediaSearch(req, res);
});

// POST /test-video - тестирование сборки видео
router.post('/test-video', (req, res) => {
    articleController.testVideoAssembly(req, res);
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

export default router; 