import { createClient } from 'pexels';
import dotenv from 'dotenv';

dotenv.config();

const client = createClient(process.env.PEXELS_API as string);

export interface MediaItem {
    id: number;
    url: string;
    previewUrl: string;
    type: 'image' | 'video';
    duration?: number;
    tags: string[];
    relevanceScore?: number;
    quality: 'hd' | 'sd';
}

export interface MediaSearchResult {
    videos: MediaItem[];
    images: MediaItem[];
    searchQuery: string;
    totalFound: number;
}

export class MediaService {
    private translateToEnglish(query: string): string {
        // Расширенный словарь для перевода ключевых слов на английский
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
            'марафон': 'marathon running',

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
            'дети': 'children kids family',

            // Технологии
            'технологии': 'technology innovation digital',
            'ИИ': 'artificial intelligence AI technology',
            'компьютер': 'computer technology digital',
            'интернет': 'internet technology digital',
            'смартфон': 'smartphone mobile technology',
            'приложение': 'app mobile technology',
            'искусственный интеллект': 'artificial intelligence AI',
            'инновации': 'innovation technology',

            // Общество и политика
            'дебаты': 'debate discussion politics',
            'политика': 'politics government society',
            'выборы': 'elections voting politics',
            'правительство': 'government politics official',
            'закон': 'law legal government',

            // Люди и социум
            'молодежь': 'youth young people',
            'семья': 'family people home',
            'работа': 'work office business',
            'бизнес': 'business office corporate',
            'деньги': 'money finance business',
            'стартап': 'startup business',
            'платформа': 'platform technology',

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

        let translatedQuery = query.toLowerCase();

        // Более умный перевод - ищем точные совпадения слов
        Object.entries(translations).forEach(([ru, en]) => {
            const regex = new RegExp(`\\b${ru}\\b`, 'gi');
            translatedQuery = translatedQuery.replace(regex, en);
        });

        return translatedQuery;
    }

    async searchVideos(query: string, limit: number = 8): Promise<MediaItem[]> {
        try {
            console.log(`🎬 Searching videos for: "${query}"`);

            if (!process.env.PEXELS_API) {
                throw new Error('PEXELS_API key not configured');
            }

            // Переводим запрос на английский для лучших результатов
            const englishQuery = this.translateToEnglish(query);
            console.log(`🌐 Translated query: "${englishQuery}"`);

            const videos = await client.videos.search({
                query: englishQuery,
                per_page: limit,
                orientation: 'portrait', // TikTok формат
                size: 'medium' // Оптимальный размер
            });

            if ('error' in videos) {
                throw new Error(`Pexels API error: ${videos.error}`);
            }

            const processedVideos = videos.videos.map(video => {
                // Выбираем лучший видео файл (HD приоритет)
                const hdFile = video.video_files.find(file =>
                    file.quality === 'hd' && file.width && file.width >= 720
                );
                const bestFile = hdFile || video.video_files[0];

                return {
                    id: video.id,
                    url: bestFile?.link || '',
                    previewUrl: video.image,
                    type: 'video' as const,
                    duration: video.duration,
                    tags: video.tags ? video.tags.map((tag: any) => tag.name || tag.toString()) : [],
                    quality: hdFile ? 'hd' as const : 'sd' as const,
                    relevanceScore: this.calculateRelevance(query, video.tags ? video.tags.map((tag: any) => tag.name || tag.toString()) : [])
                } as MediaItem;
            });

            // Сортируем по релевантности и качеству
            const sortedVideos = processedVideos.sort((a, b) => {
                const scoreA = (a.relevanceScore || 0) + (a.quality === 'hd' ? 0.2 : 0);
                const scoreB = (b.relevanceScore || 0) + (b.quality === 'hd' ? 0.2 : 0);
                return scoreB - scoreA;
            });

            console.log(`✅ Found ${sortedVideos.length} videos`);
            return sortedVideos;

        } catch (error: any) {
            console.error('Video search error:', error);
            throw new Error(`Video search failed: ${error.message}`);
        }
    }

    async searchImages(query: string, limit: number = 5): Promise<MediaItem[]> {
        try {
            console.log(`🖼️ Searching images for: "${query}"`);

            if (!process.env.PEXELS_API) {
                throw new Error('PEXELS_API key not configured');
            }

            const englishQuery = this.translateToEnglish(query);

            const photos = await client.photos.search({
                query: englishQuery,
                per_page: limit,
                orientation: 'portrait',
                size: 'large'
            });

            if ('error' in photos) {
                throw new Error(`Pexels API error: ${photos.error}`);
            }

            const processedImages = photos.photos.map(photo => ({
                id: photo.id,
                url: photo.src.large2x || photo.src.large, // Максимальное качество
                previewUrl: photo.src.medium,
                type: 'image' as const,
                tags: photo.alt ? photo.alt.split(' ').slice(0, 8) : [],
                quality: 'hd' as const,
                relevanceScore: this.calculateRelevance(query, photo.alt ? photo.alt.split(' ') : [])
            } as MediaItem));

            console.log(`✅ Found ${processedImages.length} images`);
            return processedImages.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));

        } catch (error: any) {
            console.error('Image search error:', error);
            throw new Error(`Image search failed: ${error.message}`);
        }
    }

    private calculateRelevance(query: string, tags: string[]): number {
        if (!tags.length) return 0;

        const queryWords = query.toLowerCase().split(' ').filter(word => word.length > 2);
        const tagWords = tags.join(' ').toLowerCase();

        let score = 0;
        queryWords.forEach(word => {
            if (tagWords.includes(word)) {
                score += 1;
            }
        });

        return score / queryWords.length; // Нормализация
    }

    async getMediaForArticle(
        title: string,
        keyPoints: string[],
        tags: string[]
    ): Promise<MediaSearchResult> {
        try {
            console.log('\n🎯 ===== MEDIA SEARCH STARTED =====');
            console.log('📰 Article:', title);
            console.log('🏷️ Tags:', tags.join(', '));

            // Создаем поисковые запросы на основе title, keyPoints и tags
            const searchQueries = [
                title.slice(0, 50), // Заголовок (обрезаем для лучшего поиска)
                ...keyPoints.slice(0, 2), // Первые 2 ключевые точки
                ...tags.slice(0, 3) // Первые 3 тега
            ].filter(query => query.length > 3);

            console.log('🔍 Search queries:', searchQueries);

            // Параллельный поиск по всем запросам
            const searchPromises = searchQueries.slice(0, 4).map(async (query, index) => {
                console.log(`\n🔍 Query ${index + 1}: "${query}"`);

                const [videos, images] = await Promise.all([
                    this.searchVideos(query, 3),
                    this.searchImages(query, 2)
                ]);

                return { videos, images, query };
            });

            const results = await Promise.all(searchPromises);

            // Объединяем и убираем дубликаты
            const allVideos = this.removeDuplicates(
                results.flatMap(r => r.videos),
                'id'
            ).slice(0, 10); // Топ 10 видео

            const allImages = this.removeDuplicates(
                results.flatMap(r => r.images),
                'id'
            ).slice(0, 6); // Топ 6 изображений

            console.log(`\n✅ MEDIA SEARCH COMPLETED`);
            console.log(`📹 Found videos: ${allVideos.length}`);
            console.log(`🖼️ Found images: ${allImages.length}`);
            console.log('🎯 ===== END MEDIA SEARCH =====\n');

            return {
                videos: allVideos,
                images: allImages,
                searchQuery: searchQueries.join(', '),
                totalFound: allVideos.length + allImages.length
            };

        } catch (error: any) {
            console.error('Media collection error:', error);
            throw new Error(`Media collection failed: ${error.message}`);
        }
    }

    private removeDuplicates<T>(array: T[], key: keyof T): T[] {
        const seen = new Set();
        return array.filter(item => {
            const identifier = item[key];
            if (seen.has(identifier)) {
                return false;
            }
            seen.add(identifier);
            return true;
        });
    }

    // Метод для получения лучшего видео для TikTok
    async getBestVideoForTikTok(mediaResult: MediaSearchResult): Promise<MediaItem | null> {
        const suitableVideos = mediaResult.videos.filter(video =>
            video.duration && video.duration >= 15 && video.duration <= 60 // Оптимальная длительность для TikTok
        );

        if (suitableVideos.length === 0) {
            return mediaResult.videos[0] || null;
        }

        // Возвращаем видео с лучшим соотношением качества и релевантности
        return suitableVideos.sort((a, b) => {
            const scoreA = (a.relevanceScore || 0) + (a.quality === 'hd' ? 0.3 : 0);
            const scoreB = (b.relevanceScore || 0) + (b.quality === 'hd' ? 0.3 : 0);
            return scoreB - scoreA;
        })[0];
    }
} 