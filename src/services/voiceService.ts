import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface VoiceOptions {
    voiceId?: string;
    stability?: number;
    similarityBoost?: number;
    style?: number;
    speakerBoost?: boolean;
}

export interface VoiceResult {
    audioPath: string;
    audioUrl?: string;
    duration?: number;
}

export class VoiceService {
    private apiKey: string;
    private baseUrl = 'https://api.elevenlabs.io/v1';

    constructor() {
        this.apiKey = process.env.ELEVENLABS_API_KEY || '';
        if (!this.apiKey) {
            console.warn('ELEVENLABS_API_KEY not found in environment variables');
        }
    }

    /**
     * Синтез речи через ElevenLabs API
     */
    async synthesizeSpeech(
        text: string,
        options: VoiceOptions = {}
    ): Promise<VoiceResult | null> {
        try {
            if (!this.apiKey) {
                throw new Error('ElevenLabs API key is required');
            }

            // Дефолтные настройки голоса
            const voiceSettings = {
                voiceId: options.voiceId || 'pNInz6obpgDQGcFmaJgB', // Adam voice
                stability: options.stability || 0.5,
                similarity_boost: options.similarityBoost || 0.8,
                style: options.style || 0,
                use_speaker_boost: options.speakerBoost || true
            };

            console.log(`Synthesizing speech with ElevenLabs...`);
            console.log(`Text length: ${text.length} characters`);

            // API запрос к ElevenLabs
            const response = await axios.post(
                `${this.baseUrl}/text-to-speech/${voiceSettings.voiceId}`,
                {
                    text: text,
                    model_id: 'eleven_multilingual_v2', // Поддерживает русский язык
                    voice_settings: {
                        stability: voiceSettings.stability,
                        similarity_boost: voiceSettings.similarity_boost,
                        style: voiceSettings.style,
                        use_speaker_boost: voiceSettings.use_speaker_boost
                    }
                },
                {
                    headers: {
                        'Accept': 'audio/mpeg',
                        'Content-Type': 'application/json',
                        'xi-api-key': this.apiKey
                    },
                    responseType: 'stream'
                }
            );

            // Сохраняем аудио файл
            const fileName = `audio_${uuidv4()}.mp3`;
            const audioPath = path.join(process.cwd(), fileName);

            const writer = fs.createWriteStream(audioPath);
            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', async () => {
                    console.log(`✅ Audio file created: ${audioPath}`);

                    try {
                        // Получаем длительность аудио (опционально)
                        const duration = await this.getAudioDuration(audioPath);

                        resolve({
                            audioPath,
                            duration
                        });
                    } catch (error) {
                        // Даже если не удалось получить длительность, возвращаем результат
                        resolve({
                            audioPath
                        });
                    }
                });

                writer.on('error', (error) => {
                    console.error('Error writing audio file:', error);
                    reject(error);
                });
            });

        } catch (error: any) {
            console.error('ElevenLabs synthesis error:', error.response?.data || error.message);

            if (error.response?.status === 401) {
                console.error('Invalid ElevenLabs API key');
            } else if (error.response?.status === 429) {
                console.error('ElevenLabs API rate limit exceeded');
            }

            return null;
        }
    }

    /**
     * Получить доступные голоса
     */
    async getAvailableVoices(): Promise<any[]> {
        try {
            if (!this.apiKey) {
                throw new Error('ElevenLabs API key is required');
            }

            const response = await axios.get(`${this.baseUrl}/voices`, {
                headers: {
                    'xi-api-key': this.apiKey
                }
            });

            return response.data.voices || [];
        } catch (error: any) {
            console.error('Error fetching voices:', error.response?.data || error.message);
            return [];
        }
    }

    /**
     * Получить информацию о пользователе (лимиты API)
     */
    async getUserInfo(): Promise<any> {
        try {
            if (!this.apiKey) {
                throw new Error('ElevenLabs API key is required');
            }

            const response = await axios.get(`${this.baseUrl}/user`, {
                headers: {
                    'xi-api-key': this.apiKey
                }
            });

            return response.data;
        } catch (error: any) {
            console.error('Error fetching user info:', error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Разбить длинный текст на части для синтеза
     */
    private splitText(text: string, maxLength: number = 2500): string[] {
        const parts: string[] = [];
        let start = 0;

        while (start < text.length) {
            let end = Math.min(text.length, start + maxLength);

            // Пытаемся разрезать на границе предложения
            if (end < text.length) {
                const lastPeriod = text.lastIndexOf('.', end);
                const lastExclamation = text.lastIndexOf('!', end);
                const lastQuestion = text.lastIndexOf('?', end);

                const sentenceEnd = Math.max(lastPeriod, lastExclamation, lastQuestion);

                if (sentenceEnd > start) {
                    end = sentenceEnd + 1;
                } else {
                    // Если не нашли конец предложения, режем по пробелу
                    const lastSpace = text.lastIndexOf(' ', end);
                    if (lastSpace > start) {
                        end = lastSpace;
                    }
                }
            }

            parts.push(text.substring(start, end).trim());
            start = end;
        }

        return parts.filter(part => part.length > 0);
    }

    /**
     * Синтез длинного текста с разбивкой на части
     */
    async synthesizeLongText(
        text: string,
        options: VoiceOptions = {}
    ): Promise<VoiceResult | null> {
        try {
            const maxLength = 2500; // ElevenLabs лимит на запрос

            if (text.length <= maxLength) {
                return await this.synthesizeSpeech(text, options);
            }

            console.log(`Text is too long (${text.length} chars), splitting into parts...`);

            const parts = this.splitText(text, maxLength);
            console.log(`Split into ${parts.length} parts`);

            const audioFiles: string[] = [];

            for (let i = 0; i < parts.length; i++) {
                console.log(`Processing part ${i + 1}/${parts.length}...`);

                const result = await this.synthesizeSpeech(parts[i], options);
                if (result) {
                    audioFiles.push(result.audioPath);
                    // Небольшая задержка между запросами
                    await new Promise(resolve => setTimeout(resolve, 500));
                } else {
                    throw new Error(`Failed to synthesize part ${i + 1}`);
                }
            }

            // Объединяем аудио файлы
            const finalAudioPath = await this.mergeAudioFiles(audioFiles);

            // Удаляем временные файлы
            audioFiles.forEach(file => {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                }
            });

            return {
                audioPath: finalAudioPath
            };

        } catch (error: any) {
            console.error('Error synthesizing long text:', error);
            return null;
        }
    }

    /**
     * Объединить несколько аудио файлов в один
     */
    private async mergeAudioFiles(audioFiles: string[]): Promise<string> {
        // Используем простую конкатенацию для MP3 файлов
        const finalFileName = `merged_audio_${uuidv4()}.mp3`;
        const finalPath = path.join(process.cwd(), finalFileName);

        // Для простоты, пока просто копируем первый файл
        // В продакшене здесь должна быть логика объединения через FFmpeg
        if (audioFiles.length > 0) {
            fs.copyFileSync(audioFiles[0], finalPath);
        }

        return finalPath;
    }

    /**
     * Получить длительность аудио файла
     */
    private async getAudioDuration(audioPath: string): Promise<number | undefined> {
        try {
            // Здесь можно использовать библиотеку для получения метаданных
            // Пока возвращаем undefined
            return undefined;
        } catch (error) {
            console.warn('Could not get audio duration:', error);
            return undefined;
        }
    }

    /**
     * Очистить временные аудио файлы
     */
    async cleanup(audioPath: string): Promise<void> {
        try {
            if (fs.existsSync(audioPath)) {
                fs.unlinkSync(audioPath);
                console.log(`🗑️ Cleaned up audio file: ${audioPath}`);
            }
        } catch (error) {
            console.warn('Error cleaning up audio file:', error);
        }
    }
} 