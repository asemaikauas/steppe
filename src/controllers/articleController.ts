import { Request, Response } from 'express';
import { Job } from '../models/Job';
import { scrapeSteppeArticle } from '../scraper';
import { AIService } from '../services/aiService';
import { VoiceService } from '../services/voiceService';
import { MediaService } from '../services/mediaService';
import { VideoService } from '../services/videoService';
import { v4 as uuidv4 } from 'uuid';

export class ArticleController {
    private aiService = new AIService();
    private voiceService = new VoiceService();
    private mediaService = new MediaService();
    private videoService = new VideoService();

    // POST /generate - принимает URL новости, помещает задачу в очередь
    async generateVideo(req: Request, res: Response): Promise<void> {
        try {
            const { url } = req.body;

            if (!url) {
                res.status(400).json({
                    error: 'URL is required',
                    message: 'Please provide a valid The Steppe article URL'
                });
                return;
            }

            // Валидация URL
            if (!url.includes('the-steppe.com')) {
                res.status(400).json({
                    error: 'Invalid URL',
                    message: 'Please provide a valid The Steppe article URL'
                });
                return;
            }

            // Проверяем, есть ли уже такая задача
            const existingJob = await Job.findOne({ url });
            if (existingJob) {
                res.json({
                    jobId: (existingJob._id as string).toString(),
                    status: existingJob.status,
                    message: 'Job already exists',
                    videoUrl: existingJob.videoUrl
                });
                return;
            }

            // Создаем новую задачу
            const job = new Job({
                url,
                status: 'pending'
            });

            await job.save();

            // Запускаем обработку в фоне (не ждем завершения)
            this.processVideoGeneration((job._id as string).toString()).catch(error => {
                console.error('Background processing error:', error);
            });

            res.status(201).json({
                jobId: (job._id as string).toString(),
                status: 'pending',
                message: 'Video generation started',
                estimatedTime: '2-5 minutes'
            });

        } catch (error: any) {
            console.error('Generate video error:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: error.message
            });
        }
    }

    // GET /status/:jobId - возвращает статус генерации
    async getJobStatus(req: Request, res: Response): Promise<void> {
        try {
            const { jobId } = req.params;

            const job = await Job.findById(jobId);
            if (!job) {
                res.status(404).json({
                    error: 'Job not found',
                    message: 'Invalid job ID'
                });
                return;
            }

            res.json({
                jobId: job._id,
                status: job.status,
                url: job.url,
                title: job.title,
                videoUrl: job.videoUrl,
                error: job.error,
                createdAt: job.createdAt,
                updatedAt: job.updatedAt
            });

        } catch (error: any) {
            console.error('Get job status error:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: error.message
            });
        }
    }

    // GET /jobs - получить все задачи
    async getAllJobs(req: Request, res: Response): Promise<void> {
        try {
            const { status, limit = 20 } = req.query;

            const filter: any = {};
            if (status) {
                filter.status = status;
            }

            const jobs = await Job.find(filter)
                .sort({ createdAt: -1 })
                .limit(parseInt(limit as string));

            res.json({
                jobs: jobs.map(job => ({
                    jobId: job._id,
                    status: job.status,
                    url: job.url,
                    title: job.title,
                    videoUrl: job.videoUrl,
                    createdAt: job.createdAt,
                    hasError: !!job.error
                })),
                total: jobs.length
            });

        } catch (error: any) {
            console.error('Get all jobs error:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: error.message
            });
        }
    }

    // Фоновая обработка генерации видео
    private async processVideoGeneration(jobId: string): Promise<void> {
        try {
            // Обновляем статус на "processing"
            await Job.findByIdAndUpdate(jobId, {
                status: 'processing',
                updatedAt: new Date()
            });

            const job = await Job.findById(jobId);
            if (!job) throw new Error('Job not found');

            console.log(`Starting video generation for job ${jobId}`);

            // 1. Скрапим статью
            console.log('Step 1: Scraping article...');
            const article = await scrapeSteppeArticle(job.url);
            if (!article) {
                throw new Error('Failed to scrape article content');
            }

            // Сохраняем контент в job
            await Job.findByIdAndUpdate(jobId, {
                title: article.title,
                content: article.text
            });

            // 2. Обрабатываем с помощью AI
            console.log('Step 2: Processing with AI...');
            const processedContent = await this.aiService.processArticle(
                article.title,
                article.text
            );

            // Выводим весь сгенерированный контент
            console.log('\n🎯 ===== AI PROCESSED CONTENT =====');
            console.log('📰 ARTICLE TITLE:', article.title);
            console.log('\n📝 SUMMARY:');
            console.log(processedContent.summary);
            console.log('\n💡 KEY POINTS:');
            processedContent.keyPoints.forEach((point, index) => {
                console.log(`${index + 1}. ${point}`);
            });
            console.log('\n🎬 TIKTOK SCRIPT:');
            console.log(processedContent.script);
            console.log('\n🏷️ TAGS:');
            console.log(processedContent.tags.join(', '));
            console.log('🎯 ===== END AI CONTENT =====\n');

            // 3. Генерируем метаданные
            console.log('Step 3: Generating metadata...');
            const metadata = await this.aiService.generateVideoMetadata(processedContent);

            // 4. Синтез речи
            console.log('Step 4: Synthesizing speech...');
            const voiceResult = await this.voiceService.synthesizeLongText(processedContent.script, {
                voiceId: 'pNInz6obpgDQGcFmaJgB', // Adam voice (хорошо для новостей)
                stability: 0.7,
                similarityBoost: 0.8
            });

            if (!voiceResult) {
                throw new Error('Failed to synthesize speech');
            }

            console.log(`✅ Speech synthesis completed: ${voiceResult.audioPath}`);

            // Сохраняем путь к аудио в задаче
            await Job.findByIdAndUpdate(jobId, {
                audioPath: voiceResult.audioPath,
                audioDuration: voiceResult.duration
            });

            // 5. Поиск медиа контента
            console.log('Step 5: Searching media content...');
            const mediaResult = await this.mediaService.getMediaForArticle(
                article.title,
                processedContent.keyPoints,
                processedContent.tags
            );

            // Выбираем лучшее видео для TikTok
            const bestVideo = await this.mediaService.getBestVideoForTikTok(mediaResult);

            console.log(`✅ Media search completed:`);
            console.log(`📹 Videos found: ${mediaResult.videos.length}`);
            console.log(`🖼️ Images found: ${mediaResult.images.length}`);
            if (bestVideo) {
                console.log(`🎬 Selected video: ID ${bestVideo.id}, Duration: ${bestVideo.duration}s, Quality: ${bestVideo.quality}`);
            }

            // 6. Сборка видео
            console.log('Step 6: Building video...');

            if (!bestVideo) {
                throw new Error('No suitable background video found');
            }

            const videoResult = await this.videoService.assembleVideo({
                backgroundVideo: bestVideo,
                audioPath: voiceResult.audioPath,
                audioDuration: voiceResult.duration || 30, // Fallback на 30 секунд
                script: processedContent.script,
                title: article.title,
                tags: processedContent.tags,
                resolution: '1080x1920', // TikTok формат
                outputFormat: 'mp4',
                addSubtitles: true
            });

            console.log(`✅ Video assembly completed: ${videoResult.videoPath}`);
            console.log(`📏 Resolution: ${videoResult.resolution}`);
            console.log(`📦 Size: ${(videoResult.size / 1024 / 1024).toFixed(2)} MB`);

            // Сохраняем информацию о видео в задаче
            await Job.findByIdAndUpdate(jobId, {
                videoPath: videoResult.videoPath,
                videoDuration: videoResult.duration,
                videoSize: videoResult.size,
                videoResolution: videoResult.resolution,
                hasSubtitles: videoResult.hasSubtitles
            });

            // Временно помечаем как выполненное
            await Job.findByIdAndUpdate(jobId, {
                status: 'done',
                videoUrl: `file://${videoResult.videoPath}`, // Локальный путь к файлу
                updatedAt: new Date()
            });

            console.log(`Video generation completed for job ${jobId}`);

        } catch (error: any) {
            console.error(`Video generation failed for job ${jobId}:`, error);

            await Job.findByIdAndUpdate(jobId, {
                status: 'error',
                error: error.message,
                updatedAt: new Date()
            });
        }
    }

    // POST /test-media - тестирование поиска медиа
    async testMediaSearch(req: Request, res: Response): Promise<void> {
        try {
            const { title, keyPoints, tags } = req.body;

            if (!title) {
                res.status(400).json({
                    error: 'Missing title',
                    message: 'Please provide article title'
                });
                return;
            }

            console.log('\n🎬 ===== TESTING MEDIA SEARCH =====');

            const mediaResult = await this.mediaService.getMediaForArticle(
                title,
                keyPoints || [],
                tags || []
            );

            const bestVideo = await this.mediaService.getBestVideoForTikTok(mediaResult);

            res.json({
                success: true,
                searchQuery: mediaResult.searchQuery,
                totalFound: mediaResult.totalFound,
                videos: mediaResult.videos.map(video => ({
                    id: video.id,
                    previewUrl: video.previewUrl,
                    duration: video.duration,
                    quality: video.quality,
                    relevanceScore: video.relevanceScore,
                    tags: video.tags.slice(0, 5) // Ограничиваем количество тегов
                })),
                images: mediaResult.images.map(image => ({
                    id: image.id,
                    previewUrl: image.previewUrl,
                    quality: image.quality,
                    relevanceScore: image.relevanceScore,
                    tags: image.tags.slice(0, 5)
                })),
                bestVideo: bestVideo ? {
                    id: bestVideo.id,
                    previewUrl: bestVideo.previewUrl,
                    duration: bestVideo.duration,
                    quality: bestVideo.quality,
                    relevanceScore: bestVideo.relevanceScore
                } : null
            });

        } catch (error: any) {
            console.error('Test media search error:', error);
            res.status(500).json({
                error: 'Media search failed',
                message: error.message
            });
        }
    }

    // POST /test-video - тестирование сборки видео
    async testVideoAssembly(req: Request, res: Response): Promise<void> {
        try {
            const {
                backgroundVideoUrl,
                audioPath,
                script,
                title = "Тест видео",
                duration = 15
            } = req.body;

            if (!backgroundVideoUrl || !audioPath || !script) {
                res.status(400).json({
                    error: 'Missing required fields',
                    message: 'Please provide backgroundVideoUrl, audioPath, and script'
                });
                return;
            }

            console.log('\n🎬 ===== TESTING VIDEO ASSEMBLY =====');

            // Создаем мок-объект MediaItem для тестирования
            const mockVideo = {
                id: 999999,
                url: backgroundVideoUrl,
                previewUrl: backgroundVideoUrl,
                type: 'video' as const,
                duration: duration,
                tags: [],
                quality: 'hd' as const
            };

            const videoResult = await this.videoService.assembleVideo({
                backgroundVideo: mockVideo,
                audioPath: audioPath,
                audioDuration: duration,
                script: script,
                title: title,
                tags: ['test'],
                resolution: '1080x1920',
                outputFormat: 'mp4',
                addSubtitles: true
            });

            res.json({
                success: true,
                videoPath: videoResult.videoPath,
                duration: videoResult.duration,
                size: videoResult.size,
                resolution: videoResult.resolution,
                hasSubtitles: videoResult.hasSubtitles,
                sizeMB: (videoResult.size / 1024 / 1024).toFixed(2),
                message: 'Video assembly completed successfully'
            });

        } catch (error: any) {
            console.error('Test video assembly error:', error);
            res.status(500).json({
                error: 'Video assembly failed',
                message: error.message
            });
        }
    }

    // POST /test-dynamic-video - тестирование динамических кадров
    async testDynamicVideo(req: Request, res: Response): Promise<void> {
        try {
            const {
                audioPath,
                script,
                keyPoints = [],
                title = "Тест динамического видео",
                duration = 15
            } = req.body;

            if (!audioPath || !script) {
                res.status(400).json({
                    error: 'Missing required fields',
                    message: 'Please provide audioPath and script'
                });
                return;
            }

            console.log('\n🎬 ===== TESTING DYNAMIC VIDEO =====');

            // Создаем мок-объект MediaItem для фонового видео
            const mockVideo = {
                id: 999999,
                url: 'file:///Users/asemaikauasperseverance/stepp/newsTok/backend/test_video.mp4',
                previewUrl: 'file:///Users/asemaikauasperseverance/stepp/newsTok/backend/test_video.mp4',
                type: 'video' as const,
                duration: duration,
                tags: [],
                quality: 'hd' as const
            };

            const videoResult = await this.videoService.assembleDynamicVideo({
                backgroundVideo: mockVideo,
                audioPath: audioPath,
                audioDuration: duration,
                script: script,
                title: title,
                tags: ['test'],
                keyPoints: keyPoints,
                resolution: '1080x1920',
                outputFormat: 'mp4',
                addSubtitles: true
            });

            res.json({
                success: true,
                videoPath: videoResult.videoPath,
                duration: videoResult.duration,
                size: videoResult.size,
                resolution: videoResult.resolution,
                hasSubtitles: videoResult.hasSubtitles,
                sizeMB: (videoResult.size / 1024 / 1024).toFixed(2),
                message: 'Dynamic video assembly completed successfully'
            });

        } catch (error: any) {
            console.error('Test dynamic video error:', error);
            res.status(500).json({
                error: 'Dynamic video assembly failed',
                message: error.message
            });
        }
    }
} 