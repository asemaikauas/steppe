import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { MediaItem } from './mediaService';
import { VoiceService } from './voiceService';

const execAsync = promisify(exec);

export interface VideoAssemblyOptions {
    backgroundVideo: MediaItem;
    audioPath: string;
    audioDuration: number;
    script: string;
    title: string;
    tags: string[];
    outputFormat?: 'mp4' | 'mov';
    resolution?: '1080x1920' | '720x1280'; // TikTok formats
    addSubtitles?: boolean;
}

export interface VideoResult {
    videoPath: string;
    duration: number;
    size: number; // в байтах
    resolution: string;
    hasSubtitles: boolean;
}

export class VideoService {
    private outputDir = path.join(process.cwd(), 'videos');
    private tempDir = path.join(process.cwd(), 'temp');

    constructor() {
        // Создаем необходимые директории
        this.ensureDirectories();
    }

    private ensureDirectories(): void {
        [this.outputDir, this.tempDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`📁 Created directory: ${dir}`);
            }
        });
    }

    async assembleVideo(options: VideoAssemblyOptions): Promise<VideoResult> {
        const videoId = uuidv4();
        console.log(`\n🎬 ===== VIDEO ASSEMBLY STARTED =====`);
        console.log(`🎯 Video ID: ${videoId}`);
        console.log(`🎵 Audio: ${options.audioPath}`);
        console.log(`🎥 Background: ${options.backgroundVideo.previewUrl}`);
        console.log(`⏱️ Duration: ${options.audioDuration}s`);

        try {
            // 1. Скачиваем фоновое видео
            const backgroundPath = await this.downloadBackgroundVideo(options.backgroundVideo, videoId);

            // 2. Подготавливаем субтитры (если нужно)
            let subtitlePath: string | null = null;
            if (options.addSubtitles !== false) {
                subtitlePath = await this.generateSubtitles(options.script, videoId);
            }

            // 3. Собираем финальное видео
            const outputPath = await this.assembleVideoWithFFmpeg({
                backgroundPath,
                audioPath: options.audioPath,
                subtitlePath,
                duration: options.audioDuration,
                resolution: options.resolution || '1080x1920',
                outputFormat: options.outputFormat || 'mp4',
                videoId
            });

            // 4. Получаем информацию о готовом видео
            const videoInfo = await this.getVideoInfo(outputPath);

            // 5. Очищаем временные файлы
            await this.cleanupTempFiles([backgroundPath, subtitlePath]);

            console.log(`✅ VIDEO ASSEMBLY COMPLETED`);
            console.log(`📁 Output: ${outputPath}`);
            console.log(`📏 Resolution: ${videoInfo.resolution}`);
            console.log(`⏱️ Duration: ${videoInfo.duration}s`);
            console.log(`📦 Size: ${(videoInfo.size / 1024 / 1024).toFixed(2)} MB`);
            console.log(`🎬 ===== END VIDEO ASSEMBLY =====\n`);

            return {
                videoPath: outputPath,
                duration: videoInfo.duration,
                size: videoInfo.size,
                resolution: videoInfo.resolution,
                hasSubtitles: !!subtitlePath
            };

        } catch (error: any) {
            console.error(`❌ Video assembly failed for ${videoId}:`, error);
            throw new Error(`Video assembly failed: ${error.message}`);
        }
    }

    private async downloadBackgroundVideo(video: MediaItem, videoId: string): Promise<string> {
        console.log(`📥 Downloading background video...`);

        const tempPath = path.join(this.tempDir, `bg_${videoId}.mp4`);

        try {
            // Используем curl для скачивания видео
            await execAsync(`curl -L -o "${tempPath}" "${video.url}"`);

            if (!fs.existsSync(tempPath)) {
                throw new Error('Failed to download background video');
            }

            const stats = fs.statSync(tempPath);
            console.log(`✅ Downloaded: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

            return tempPath;
        } catch (error: any) {
            throw new Error(`Failed to download video: ${error.message}`);
        }
    }

    private async generateSubtitles(script: string, videoId: string): Promise<string> {
        console.log(`📝 Generating subtitles...`);

        const subtitlePath = path.join(this.tempDir, `subtitles_${videoId}.srt`);

        try {
            // Очищаем текст от эмодзи и лишних символов
            const cleanScript = script.replace(/[^\w\sА-Яа-яё.,!?-]/g, '').trim();

            // Разбиваем на слова
            const words = cleanScript.split(' ');
            const chunks: string[] = [];

            // Создаем чанки по 2-3 слова для БЫСТРОЙ смены (как в TikTok)
            for (let i = 0; i < words.length; i += 3) {
                const chunk = words.slice(i, i + 3).join(' ');
                chunks.push(chunk);
            }

            // Создаем SRT файл
            let srtContent = '';
            const chunkDuration = 2; // 2 секунды на chunk - быстрее!

            chunks.forEach((chunk, index) => {
                const startTime = this.formatSRTTime(index * chunkDuration);
                const endTime = this.formatSRTTime((index + 1) * chunkDuration);

                srtContent += `${index + 1}\n`;
                srtContent += `${startTime} --> ${endTime}\n`;
                srtContent += `${chunk}\n\n`; // Одна строка!
            });

            // ВАЖНО: Добавляем пустой сегмент в конце чтобы субтитры не обрезались
            const totalDuration = chunks.length * chunkDuration;
            if (totalDuration < 60) { // Максимум 60 секунд
                const endTime = this.formatSRTTime(Math.max(totalDuration + 5, 30)); // Минимум 30 сек
                srtContent += `${chunks.length + 1}\n`;
                srtContent += `${this.formatSRTTime(totalDuration)} --> ${endTime}\n`;
                srtContent += `\n\n`; // Пустой сегмент для продления
            }

            fs.writeFileSync(subtitlePath, srtContent, 'utf8');
            console.log(`✅ Subtitles generated: ${chunks.length} fast-sync segments (2s each, extended to ${Math.max(totalDuration + 5, 30)}s)`);

            return subtitlePath;
        } catch (error: any) {
            console.error('Subtitle generation error:', error);
            throw new Error(`Failed to generate subtitles: ${error.message}`);
        }
    }

    private formatSRTTime(seconds: number): string {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        const milliseconds = Math.floor((seconds % 1) * 1000);

        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
    }

    // Общий метод для создания FFmpeg команд
    private buildFFmpegCommand(params: {
        inputs: string[];
        duration: number;
        resolution: string;
        subtitlePath?: string | null;
        outputPath: string;
        videoFilter?: string;
        isDynamic?: boolean;
    }): string {
        const [width, height] = params.resolution.split('x');

        let command = ['ffmpeg -y'];

        // Добавляем входные файлы
        if (params.isDynamic) {
            command.push('-f concat -safe 0');
        }
        params.inputs.forEach(input => command.push(`-i "${input}"`));

        // ВАЖНО: Используем длительность аудио, а не фонового видео
        command.push(`-t ${params.duration}`);

        // Создаем водяной знак STEPPE
        const steppeWatermark = `drawtext=text='STEPPE':fontfile=/System/Library/Fonts/Arial.ttf:fontsize=60:fontcolor=black:alpha=0.9:x=(w-text_w)/2:y=80:box=1:boxcolor=black@0.3:boxborderw=5`;

        // Видео фильтры
        if (params.subtitlePath) {
            const subtitleFilter = `subtitles='${params.subtitlePath}':force_style='FontName=Inter,FontSize=14,PrimaryColour=&Hffffff,Outline=0,Bold=0,MarginV=50,Alignment=1'`;
            const scaleFilter = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}[scaled]`;
            // Комбинируем: масштабирование → водяной знак → субтитры
            command.push(`-filter_complex "${scaleFilter};[scaled]${steppeWatermark}[watermarked];[watermarked]${subtitleFilter}[video]"`);
            command.push('-map "[video]"', '-map 1:a');
        } else if (params.videoFilter) {
            command.push(`-vf "${params.videoFilter},${steppeWatermark}"`);
        } else {
            command.push(`-vf "scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},${steppeWatermark}"`);
        }

        // Кодеки и настройки
        command.push(
            '-c:v libx264',
            '-c:a aac',
            '-b:v 2M',
            '-b:a 128k',
            '-preset fast',
            '-movflags +faststart',
            // ВАЖНО: Зацикливаем видео если оно короче аудио
            '-stream_loop -1',
            `"${params.outputPath}"`
        );

        return command.join(' ');
    }

    private async assembleVideoWithFFmpeg(params: {
        backgroundPath: string;
        audioPath: string;
        subtitlePath: string | null;
        duration: number;
        resolution: string;
        outputFormat: string;
        videoId: string;
    }): Promise<string> {
        console.log(`🔧 Assembling video with FFmpeg...`);

        const outputPath = path.join(this.outputDir, `tiktok_${params.videoId}.${params.outputFormat}`);

        const command = this.buildFFmpegCommand({
            inputs: [params.backgroundPath, params.audioPath],
            duration: params.duration,
            resolution: params.resolution,
            subtitlePath: params.subtitlePath,
            outputPath
        });

        console.log(`🎬 FFmpeg command: ${command.substring(0, 100)}...`);

        try {
            const { stdout, stderr } = await execAsync(command);

            if (!fs.existsSync(outputPath)) {
                throw new Error('FFmpeg did not produce output file');
            }

            console.log(`✅ Video assembled successfully`);
            return outputPath;

        } catch (error: any) {
            console.error('FFmpeg error:', error);
            throw new Error(`FFmpeg processing failed: ${error.message}`);
        }
    }

    private async getVideoInfo(videoPath: string): Promise<{
        duration: number;
        size: number;
        resolution: string;
    }> {
        try {
            // Получаем информацию о видео через ffprobe
            const command = `ffprobe -v quiet -print_format json -show_format -show_streams "${videoPath}"`;
            const { stdout } = await execAsync(command);
            const info = JSON.parse(stdout);

            const videoStream = info.streams.find((stream: any) => stream.codec_type === 'video');
            const stats = fs.statSync(videoPath);

            return {
                duration: parseFloat(info.format.duration),
                size: stats.size,
                resolution: `${videoStream.width}x${videoStream.height}`
            };
        } catch (error: any) {
            throw new Error(`Failed to get video info: ${error.message}`);
        }
    }

    private async cleanupTempFiles(filePaths: (string | null)[]): Promise<void> {
        console.log(`🧹 Cleaning up temporary files...`);

        for (const filePath of filePaths) {
            if (filePath && fs.existsSync(filePath)) {
                try {
                    fs.unlinkSync(filePath);
                    console.log(`🗑️ Deleted: ${path.basename(filePath)}`);
                } catch (error) {
                    console.warn(`⚠️ Could not delete ${filePath}:`, error);
                }
            }
        }
    }

    // Метод для получения всех созданных видео
    async getVideoList(): Promise<Array<{
        filename: string;
        path: string;
        size: number;
        created: Date;
    }>> {
        try {
            const files = fs.readdirSync(this.outputDir);
            const videoFiles = files.filter(file =>
                file.endsWith('.mp4') || file.endsWith('.mov')
            );

            return videoFiles.map(filename => {
                const filepath = path.join(this.outputDir, filename);
                const stats = fs.statSync(filepath);

                return {
                    filename,
                    path: filepath,
                    size: stats.size,
                    created: stats.birthtime
                };
            }).sort((a, b) => b.created.getTime() - a.created.getTime());

        } catch (error: any) {
            throw new Error(`Failed to get video list: ${error.message}`);
        }
    }

    // Метод для очистки старых видео
    async cleanupOldVideos(maxAgeHours: number = 24): Promise<number> {
        try {
            const videos = await this.getVideoList();
            const cutoffTime = new Date(Date.now() - (maxAgeHours * 60 * 60 * 1000));

            let deletedCount = 0;

            for (const video of videos) {
                if (video.created < cutoffTime) {
                    fs.unlinkSync(video.path);
                    deletedCount++;
                    console.log(`🗑️ Deleted old video: ${video.filename}`);
                }
            }

            return deletedCount;
        } catch (error: any) {
            console.error('Cleanup error:', error);
            return 0;
        }
    }

    async assembleDynamicVideo(options: VideoAssemblyOptions & {
        keyPoints: string[];
        contentSegments?: Array<{
            text: string;
            searchQuery: string;
            duration: number;
        }>;
    }): Promise<VideoResult> {
        const videoId = uuidv4();
        console.log(`\n🎬 ===== DYNAMIC VIDEO ASSEMBLY STARTED =====`);
        console.log(`🎯 Video ID: ${videoId}`);
        console.log(`🎵 Audio: ${options.audioPath}`);
        console.log(`⏱️ Duration: ${options.audioDuration}s`);

        try {
            // 1. Анализируем скрипт и создаем сегменты
            const segments = await this.createContentSegments(options.script, options.keyPoints, options.audioDuration);

            // 2. Скачиваем медиа для каждого сегмента
            const mediaSegments = await this.downloadSegmentMedia(segments, videoId);

            // 3. Подготавливаем субтитры
            let subtitlePath: string | null = null;
            if (options.addSubtitles !== false) {
                subtitlePath = await this.generateSubtitles(options.script, videoId);
            }

            // 4. Собираем динамическое видео
            const outputPath = await this.assembleDynamicVideoWithFFmpeg({
                mediaSegments,
                audioPath: options.audioPath,
                subtitlePath,
                duration: options.audioDuration,
                resolution: options.resolution || '1080x1920',
                outputFormat: options.outputFormat || 'mp4',
                videoId
            });

            // 5. Получаем информацию о готовом видео
            const videoInfo = await this.getVideoInfo(outputPath);

            // 6. Очищаем временные файлы
            const tempFiles = [subtitlePath, ...mediaSegments.map(s => s.localPath)];
            await this.cleanupTempFiles(tempFiles);

            console.log(`✅ DYNAMIC VIDEO ASSEMBLY COMPLETED`);
            console.log(`📁 Output: ${outputPath}`);
            console.log(`📏 Resolution: ${videoInfo.resolution}`);
            console.log(`⏱️ Duration: ${videoInfo.duration}s`);
            console.log(`🎬 Segments: ${segments.length} content changes`);
            console.log(`🎬 ===== END DYNAMIC VIDEO ASSEMBLY =====\n`);

            return {
                videoPath: outputPath,
                duration: videoInfo.duration,
                size: videoInfo.size,
                resolution: videoInfo.resolution,
                hasSubtitles: !!subtitlePath
            };

        } catch (error: any) {
            console.error(`❌ Dynamic video assembly failed for ${videoId}:`, error);
            throw new Error(`Dynamic video assembly failed: ${error.message}`);
        }
    }

    private async createContentSegments(script: string, keyPoints: string[], totalDuration: number): Promise<Array<{
        text: string;
        searchQuery: string;
        startTime: number;
        duration: number;
    }>> {
        console.log(`🔍 Creating content segments...`);

        // Очищаем текст
        const cleanScript = script.replace(/[^\w\sА-Яа-яё.,!?-]/g, '').trim();
        const sentences = cleanScript.split(/[.!?]+/).filter(s => s.trim().length > 0);

        const segmentDuration = 4; // 4 секунды на сегмент
        const segments: Array<{
            text: string;
            searchQuery: string;
            startTime: number;
            duration: number;
        }> = [];

        for (let i = 0; i < sentences.length && i * segmentDuration < totalDuration; i++) {
            const sentence = sentences[i].trim();

            // Генерируем поисковый запрос для сегмента
            let searchQuery = this.extractSearchQuery(sentence, keyPoints);

            segments.push({
                text: sentence,
                searchQuery,
                startTime: i * segmentDuration,
                duration: Math.min(segmentDuration, totalDuration - (i * segmentDuration))
            });
        }

        console.log(`✅ Created ${segments.length} content segments`);
        segments.forEach((seg, i) => {
            console.log(`   ${i + 1}. "${seg.text.substring(0, 50)}..." → "${seg.searchQuery}"`);
        });

        return segments;
    }

    private extractSearchQuery(text: string, keyPoints: string[]): string {
        // Расширенный словарь для перевода ключевых слов
        const translations: { [key: string]: string } = {
            // Здоровье и медицина
            'здоровье': 'health medical',
            'спорт': 'sport fitness',
            'бег': 'running jogging',
            'жара': 'summer heat weather',
            'сердце': 'heart cardio medical',
            'тренировка': 'workout training gym',
            'питание': 'nutrition food healthy',
            'болезнь': 'illness disease medical',
            'врач': 'doctor medical hospital',
            'лекарство': 'medicine pharmacy medical',

            // Наука и исследования
            'исследование': 'research science laboratory',
            'ученые': 'scientists research laboratory',
            'наука': 'science research technology',
            'эксперимент': 'experiment laboratory science',
            'данные': 'data analysis research',

            // География и места
            'алматы': 'almaty kazakhstan city urban',
            'казахстан': 'kazakhstan central asia',
            'астана': 'astana nur-sultan kazakhstan',
            'город': 'city urban buildings',
            'улица': 'street road urban',
            'парк': 'park nature green',
            'горы': 'mountains landscape nature',

            // Экология и окружающая среда
            'загрязнение': 'pollution environment ecology',
            'воздух': 'air pollution environment',
            'экология': 'ecology environment nature',
            'природа': 'nature landscape environment',
            'климат': 'climate weather environment',
            'мусор': 'waste garbage pollution',

            // Образование
            'образование': 'education school university',
            'школа': 'school education children',
            'университет': 'university college education',
            'студенты': 'students university education',
            'учеба': 'study education learning',
            'экзамен': 'exam test education',

            // Технологии
            'технологии': 'technology innovation digital',
            'ИИ': 'artificial intelligence AI technology',
            'компьютер': 'computer technology digital',
            'интернет': 'internet technology digital',
            'смартфон': 'smartphone mobile technology',
            'приложение': 'app mobile technology',

            // Общество и политика
            'дебаты': 'debate discussion politics',
            'политика': 'politics government society',
            'выборы': 'elections voting politics',
            'правительство': 'government politics official',
            'закон': 'law legal government',

            // Люди и социум
            'молодежь': 'youth young people',
            'дети': 'children kids family',
            'семья': 'family people home',
            'работа': 'work office business',
            'бизнес': 'business office corporate',
            'деньги': 'money finance business',

            // Культура и развлечения
            'культура': 'culture art tradition',
            'искусство': 'art culture creative',
            'музыка': 'music concert performance',
            'театр': 'theater performance culture',
            'кино': 'cinema movie entertainment',
            'фестиваль': 'festival celebration culture',

            // Транспорт
            'транспорт': 'transport traffic urban',
            'автомобиль': 'car vehicle traffic',
            'автобус': 'bus public transport',
            'метро': 'subway metro transport',
            'дорога': 'road traffic transport',

            // Еда и рестораны
            'еда': 'food restaurant cooking',
            'ресторан': 'restaurant food dining',
            'кафе': 'cafe coffee restaurant',
            'готовка': 'cooking food kitchen',

            // Погода и время года
            'зима': 'winter snow cold',
            'лето': 'summer sun hot',
            'весна': 'spring flowers nature',
            'осень': 'autumn fall leaves',
            'дождь': 'rain weather storm',
            'снег': 'snow winter cold'
        };

        // Анализируем текст более глубоко
        const words = text.toLowerCase().split(/[\s.,!?]+/).filter(w => w.length > 2);
        let searchTerms: string[] = [];
        let contextTerms: string[] = [];

        // Добавляем прямые переводы
        words.forEach(word => {
            if (translations[word]) {
                searchTerms.push(translations[word]);
            }
        });

        // Анализируем контекст для более точного поиска
        if (text.toLowerCase().includes('загрязн') || text.toLowerCase().includes('эколог')) {
            contextTerms.push('pollution environment');
        }
        if (text.toLowerCase().includes('здоров') || text.toLowerCase().includes('медицин')) {
            contextTerms.push('health medical');
        }
        if (text.toLowerCase().includes('образован') || text.toLowerCase().includes('школ') || text.toLowerCase().includes('студент')) {
            contextTerms.push('education school');
        }
        if (text.toLowerCase().includes('технолог') || text.toLowerCase().includes('цифров') || text.toLowerCase().includes('ИИ')) {
            contextTerms.push('technology digital');
        }
        if (text.toLowerCase().includes('политик') || text.toLowerCase().includes('правительств') || text.toLowerCase().includes('выбор')) {
            contextTerms.push('politics government');
        }

        // Добавляем релевантные keyPoints
        keyPoints.forEach(point => {
            const pointLower = point.toLowerCase();
            if (text.toLowerCase().includes(pointLower)) {
                if (translations[pointLower]) {
                    searchTerms.push(translations[pointLower]);
                } else if (pointLower.length > 2) {
                    searchTerms.push(point);
                }
            }
        });

        // Объединяем все термины
        const allTerms = [...searchTerms, ...contextTerms];

        // Fallback на более специфичные термины в зависимости от контекста
        if (allTerms.length === 0) {
            if (text.toLowerCase().includes('казахстан') || text.toLowerCase().includes('алматы')) {
                allTerms.push('kazakhstan city urban');
            } else if (text.toLowerCase().includes('люди') || text.toLowerCase().includes('человек')) {
                allTerms.push('people society');
            } else {
                allTerms.push('modern life urban');
            }
        }

        // Возвращаем максимум 4 термина для более точного поиска
        return allTerms.slice(0, 4).join(' ');
    }

    private async downloadSegmentMedia(segments: Array<{
        text: string;
        searchQuery: string;
        startTime: number;
        duration: number;
    }>, videoId: string): Promise<Array<{
        searchQuery: string;
        localPath: string;
        startTime: number;
        duration: number;
    }>> {
        console.log(`📥 Downloading media for segments...`);

        const mediaSegments: Array<{
            searchQuery: string;
            localPath: string;
            startTime: number;
            duration: number;
        }> = [];

        // Импортируем MediaService для реального поиска
        const { MediaService } = await import('./mediaService');
        const mediaService = new MediaService();

        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            const segmentPath = path.join(this.tempDir, `segment_${videoId}_${i}.mp4`);

            try {
                console.log(`   🔍 Searching for: "${segment.searchQuery}"`);

                // Ищем релевантные видео через MediaService
                const searchResults = await mediaService.searchVideos(segment.searchQuery, 3);

                if (searchResults.length > 0) {
                    // Берем первое подходящее видео
                    const selectedVideo = searchResults[0];
                    console.log(`   📹 Found: ${selectedVideo.tags?.join(', ') || 'No tags'}`);

                    // Скачиваем видео
                    const response = await fetch(selectedVideo.url);
                    if (response.ok) {
                        const buffer = await response.arrayBuffer();
                        const fs = require('fs');
                        fs.writeFileSync(segmentPath, Buffer.from(buffer));

                        console.log(`   ✅ Downloaded: ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB`);
                    } else {
                        throw new Error(`Failed to download video: ${response.status}`);
                    }
                } else {
                    console.log(`   ⚠️ No videos found for "${segment.searchQuery}", using fallback`);
                    throw new Error('No videos found');
                }

                mediaSegments.push({
                    searchQuery: segment.searchQuery,
                    localPath: segmentPath,
                    startTime: segment.startTime,
                    duration: segment.duration
                });

                console.log(`   ✅ Segment ${i + 1}: "${segment.searchQuery}" → ${path.basename(segmentPath)}`);

            } catch (error) {
                console.error(`   ❌ Failed to download for "${segment.searchQuery}":`, error);

                // Fallback стратегия
                try {
                    if (i > 0 && mediaSegments[i - 1]) {
                        // Используем предыдущий успешный сегмент
                        await execAsync(`cp "${mediaSegments[i - 1].localPath}" "${segmentPath}"`);
                        console.log(`   🔄 Used previous segment as fallback`);
                    } else {
                        // Используем базовое тестовое видео
                        await execAsync(`cp test_video.mp4 "${segmentPath}"`);
                        console.log(`   🔄 Used base video as fallback`);
                    }

                    mediaSegments.push({
                        searchQuery: `${segment.searchQuery} (fallback)`,
                        localPath: segmentPath,
                        startTime: segment.startTime,
                        duration: segment.duration
                    });
                } catch (fallbackError) {
                    console.error(`   💥 Fallback also failed:`, fallbackError);
                    throw new Error(`Failed to create segment ${i + 1}`);
                }
            }
        }

        console.log(`✅ Media download completed: ${mediaSegments.length} segments`);
        return mediaSegments;
    }

    private async assembleDynamicVideoWithFFmpeg(params: {
        mediaSegments: Array<{
            localPath: string;
            startTime: number;
            duration: number;
        }>;
        audioPath: string;
        subtitlePath: string | null;
        duration: number;
        resolution: string;
        outputFormat: string;
        videoId: string;
    }): Promise<string> {
        console.log(`🔧 Assembling dynamic video with FFmpeg...`);

        const outputPath = path.join(this.outputDir, `dynamic_${params.videoId}.${params.outputFormat}`);

        // Создаем concat файл для FFmpeg
        const concatFile = path.join(this.tempDir, `concat_${params.videoId}.txt`);
        let concatContent = '';

        for (const segment of params.mediaSegments) {
            concatContent += `file '${segment.localPath}'\n`;
            concatContent += `duration ${segment.duration}\n`;
        }

        fs.writeFileSync(concatFile, concatContent);

        const command = this.buildFFmpegCommand({
            inputs: [concatFile, params.audioPath],
            duration: params.duration,
            resolution: params.resolution,
            subtitlePath: params.subtitlePath,
            outputPath,
            isDynamic: true
        });

        console.log(`🎬 FFmpeg dynamic command: ${command.substring(0, 100)}...`);

        try {
            await execAsync(command);

            if (!fs.existsSync(outputPath)) {
                throw new Error('FFmpeg did not produce output file');
            }

            console.log(`✅ Dynamic video assembled successfully`);

            // Очищаем concat файл
            fs.unlinkSync(concatFile);

            return outputPath;

        } catch (error: any) {
            console.error('FFmpeg dynamic error:', error);
            throw new Error(`FFmpeg dynamic processing failed: ${error.message}`);
        }
    }
} 