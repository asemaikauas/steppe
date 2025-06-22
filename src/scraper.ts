import axios from 'axios';
import { load } from 'cheerio';
import { schedule } from 'node-cron';
import { saveDataToMongoDB } from './storage';

import { processHeadlines } from './readHeadlines';

const baseUrl: string = 'https://the-steppe.com';

interface Article {
  title: string;
  text: string;
}

// Function to scrape a specific The Steppe article
const scrapeSteppeArticle = async (articleUrl: string): Promise<Article | null> => {
  try {
    console.log(`Fetching The Steppe article: ${articleUrl}`);
    const response = await axios.get(articleUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    const $ = load(response.data);

    // Extract title - The Steppe uses h1 for article titles
    let title = $('h1').first().text().trim();

    // If no h1, try title tag
    if (!title) {
      title = $('title').text().split('|')[0].split('—')[0].trim();
    }

    // Extract article content - The Steppe articles contain the main text in paragraphs
    let content = '';

    // The Steppe articles have their content in paragraph tags within the main content area
    // Look for paragraphs that contain substantial text (not just navigation or metadata)
    const paragraphs = $('p').map((idx, el) => {
      const text = $(el).text().trim();
      // Filter out short paragraphs, navigation text, dates, etc.
      if (text.length > 50 &&
        !text.includes('GMT+05') &&
        !text.includes('минут') &&
        !text.includes('Подписаться') &&
        !text.includes('Поделись') &&
        !text.includes('© 2024') &&
        !text.includes('STEPPE') &&
        !text.match(/^\d+$/)) {
        return text;
      }
      return null;
    }).get().filter(text => text !== null);

    content = paragraphs.join(' ');

    // Clean up title and content
    title = title.replace(/\s+/g, ' ').trim();
    content = content.replace(/\s+/g, ' ').trim();

    // Only return if we have meaningful content
    if (title.length > 10 && content.length > 200) {
      console.log(`Successfully scraped: "${title.substring(0, 80)}..."`);
      console.log(`Content length: ${content.length} characters`);
      return { title, text: content };
    } else {
      console.log(`Insufficient content for article: ${title}`);
      return null;
    }

  } catch (error: any) {
    console.log(`Error scraping article ${articleUrl}:`, error.message);
    return null;
  }
};

// Function to get latest articles from The Steppe
const parseSteppeArticles = async (): Promise<Article[]> => {
  try {
    console.log('Fetching latest articles from The Steppe...');

    // Current articles from The Steppe (you can update these URLs as needed)
    const currentArticles = [
      '/lyudi/otmena-bojkot-reputacija-kak-kazahstancy-vosprinimajut-cancel-culture',
      '/novosti/zhara-i-beg-gotovo-li-vashe-serdce-k-marafonu-i-letnim-trenirovkam',
      '/eda/kak-med-iz-sela-prevratilsja-v-premialnyj-brend-istorija-poliny-troeglazovoj',
      '/novye-znanija/chto-proishodit-s-beauty-rynkom-v-kazahstane-analitika-ot-zolotogo-jabloka-i-mirovyh-brendov',
      '/sobytija/oyu-fest-2025-pri-podderzhke-kaspi-kz-stal-muzykalnym-sobytiem-goda',
      '/intervju/she-is-someone-manizha-o-novyh-smyslah-zhenskoi-sily-i-pesne-begi',
      '/lyudi/novoe-vremia-novye-liudi-6-molodyh-kreatorov-kazahstana-dostigshih-uspeha'
    ];

    const articles: Article[] = [];

    // Scrape each article
    for (const articlePath of currentArticles) {
      const fullUrl = baseUrl + articlePath;
      const article = await scrapeSteppeArticle(fullUrl);

      if (article) {
        articles.push(article);
      }

      // Add delay to be respectful to the server
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    console.log(`Successfully scraped ${articles.length} articles from The Steppe`);
    return articles;

  } catch (error) {
    console.error('Error parsing The Steppe articles:', error);
    return [];
  }
};

const parsePage = async (pageNumber: number): Promise<Article[]> => {
  // For The Steppe, we'll use the specialized function instead
  if (pageNumber === 1) {
    return await parseSteppeArticles();
  }
  return [];
};

const parsePages = async (): Promise<void> => {
  console.log('Starting to scrape The Steppe...');
  const allHeadlines = await parseSteppeArticles();

  console.log(`Total articles scraped from The Steppe: ${allHeadlines.length}`);

  if (allHeadlines.length > 0) {
    await saveDataToMongoDB(allHeadlines, "The Steppe");
    console.log('Articles saved to database. Processing headlines...');
    await processHeadlines();
  } else {
    console.log('No articles found to save.');
  }
};

// parsePages()

// schedule('0 */3 * * *', () => {
//   console.log('Running the cron job every 3 hours');
//   parsePages();
// });

export { parsePage, parsePages, scrapeSteppeArticle };