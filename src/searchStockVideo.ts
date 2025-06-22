import dotenv from 'dotenv';
dotenv.config();

import { createClient } from "pexels";

const client = createClient(process.env.PEXELS_API as string);

interface VideoSearchResult {
  videos: {
    video_files: {
      link: string;
      width: number
    }[];
  }[];
}

async function searchVideos(query: string): Promise<string | null> {
    try {
        const response = await client.videos.search({ query, size: "medium" }) as VideoSearchResult;
        const videosLength = response.videos.length;
        if (videosLength > 0) {

            let random = Math.floor(Math.random() * videosLength)

            let url: string | null = null;

            response.videos[random].video_files.forEach((el, i) => {
                url = el.link
            })

            return url;
        } else {
            console.log('No videos found for the query:', query);
            return null;
        }
    } catch (error) {
        console.error('Search failed:', error);
        return null;
    }
}

export { searchVideos };