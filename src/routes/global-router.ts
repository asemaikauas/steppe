import { Router } from 'express'
import videosRouter from './videos/videos-router'
import articleRouter from './article'
import { parsePages, scrapeSteppeArticle } from '../scraper'

const globalRouter = Router()

globalRouter.use('/videos', videosRouter)
globalRouter.use('/article', articleRouter)

// Scrape a specific The Steppe article by URL
globalRouter.post('/scrape-article', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({
                message: 'URL is required',
                error: 'Please provide a valid The Steppe article URL',
                timestamp: new Date().toISOString()
            });
        }

        // Validate that it's a The Steppe URL
        if (!url.includes('the-steppe.com')) {
            return res.status(400).json({
                message: 'Invalid URL',
                error: 'Please provide a valid The Steppe article URL (must contain "the-steppe.com")',
                timestamp: new Date().toISOString()
            });
        }

        console.log(`Scraping specific article: ${url}`);

        const { scrapeSteppeArticle } = await import('../scraper');
        const article = await scrapeSteppeArticle(url);

        if (article) {
            // Save the article to database
            const { saveDataToMongoDB } = await import('../storage');
            await saveDataToMongoDB([article], "The Steppe");

            // Process the article for video generation
            const { processHeadlines } = await import('../readHeadlines');
            await processHeadlines();

            res.json({
                message: 'Article scraped and processed successfully!',
                article: {
                    title: article.title,
                    contentLength: article.text.length,
                    preview: article.text.substring(0, 300) + '...',
                    url: url
                },
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(404).json({
                message: 'Unable to scrape article',
                error: 'No content found or article format not supported',
                url: url,
                timestamp: new Date().toISOString()
            });
        }
    } catch (error: any) {
        console.error('Article scraping failed:', error);
        res.status(500).json({
            message: 'Article scraping failed',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Get scraping status endpoint
globalRouter.get('/scrape-status', async (req, res) => {
    try {
        const { Text } = await import('../routes/videos/models/text');
        const totalArticles = await Text.countDocuments({ source: "The Steppe" });
        const recentArticles = await Text.find({ source: "The Steppe" })
            .sort({ date: -1 })
            .limit(5)
            .select('title date link error text');

        res.json({
            message: 'Scraping status retrieved',
            stats: {
                totalArticles,
                source: 'The Steppe',
                recentArticles: recentArticles.map(article => ({
                    title: article.title,
                    date: article.date,
                    hasVideo: !!article.link,
                    processed: !article.error,
                    contentLength: article.text ? article.text.length : 0,
                    preview: article.text ? article.text.substring(0, 150) + '...' : 'No content'
                }))
            },
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        console.error('Failed to get scraping status:', error);
        res.status(500).json({
            message: 'Failed to get scraping status',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Get all scraped articles (including those without videos)
globalRouter.get('/articles', async (req, res) => {
    try {
        const { Text } = await import('../routes/videos/models/text');
        const articles = await Text.find({ source: "The Steppe" })
            .sort({ date: -1 })
            .select('title date link error text');

        res.json({
            message: 'All scraped articles retrieved',
            articles: articles.map(article => ({
                title: article.title,
                date: article.date,
                hasVideo: !!article.link,
                processed: !article.error,
                contentLength: article.text ? article.text.length : 0,
                preview: article.text ? article.text.substring(0, 200) + '...' : 'No content'
            })),
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        console.error('Failed to get articles:', error);
        res.status(500).json({
            message: 'Failed to get articles',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

export default globalRouter
