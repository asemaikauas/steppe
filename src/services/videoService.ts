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

            // Создаем чанки по 6-8 слов для 2 строк субтитров
            for (let i = 0; i < words.length; i += 8) {
                const chunk = words.slice(i, i + 8).join(' ');
                chunks.push(chunk);
            }

            // Создаем SRT файл
            let srtContent = '';
            const chunkDuration = 4; // 4 секунды на chunk

            chunks.forEach((chunk, index) => {
                const startTime = this.formatSRTTime(index * chunkDuration);
                const endTime = this.formatSRTTime((index + 1) * chunkDuration);

                // Разбиваем чанк на 2 строки максимум
                const chunkWords = chunk.split(' ');
                const midPoint = Math.ceil(chunkWords.length / 2);
                const line1 = chunkWords.slice(0, midPoint).join(' ');
                const line2 = chunkWords.slice(midPoint).join(' ');

                srtContent += `${index + 1}\n`;
                srtContent += `${startTime} --> ${endTime}\n`;
                if (line2.trim()) {
                    srtContent += `${line1}\n${line2}\n\n`;
                } else {
                    srtContent += `${line1}\n\n`;
                }
            });

            fs.writeFileSync(subtitlePath, srtContent, 'utf8');
            console.log(`✅ Subtitles generated: ${chunks.length} segments`);

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

        // Базовая команда FFmpeg
        let ffmpegCommand = [
            'ffmpeg -y', // Перезаписывать выходной файл
            `-i "${params.backgroundPath}"`, // Входное видео
            `-i "${params.audioPath}"`, // Входное аудио
            `-t ${params.duration}`, // Длительность
            `-vf "scale=${params.resolution}:force_original_aspect_ratio=increase,crop=${params.resolution.replace('x', ':')}"`, // Масштабирование для TikTok
            '-c:v libx264', // Видео кодек
            '-c:a aac', // Аудио кодек
            '-b:v 2M', // Битрейт видео
            '-b:a 128k', // Битрейт аудио
            '-preset fast', // Скорость кодирования
            '-movflags +faststart' // Быстрый старт для веб
        ];

        // Добавляем субтитры если есть
        if (params.subtitlePath) {
            // Используем filter_complex для наложения субтитров
            const [width, height] = params.resolution.split('x');
            ffmpegCommand = [
                'ffmpeg -y',
                `-i "${params.backgroundPath}"`,
                `-i "${params.audioPath}"`,
                `-t ${params.duration}`,
                `-filter_complex "[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}[scaled];[scaled]subtitles='${params.subtitlePath}':force_style='FontSize=18,PrimaryColour=&Hffffff,OutlineColour=&H000000,Outline=1,Bold=0,MarginV=60'[video]"`,
                '-map "[video]"',
                '-map 1:a',
                '-c:v libx264',
                '-c:a aac',
                '-b:v 2M',
                '-b:a 128k',
                '-preset fast',
                '-movflags +faststart'
            ];
        }

        ffmpegCommand.push(`"${outputPath}"`);

        const command = ffmpegCommand.join(' ');
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
} 