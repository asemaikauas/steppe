import mongoose, { Document, Schema } from 'mongoose';

export interface IJob extends Document {
    url: string;
    status: 'pending' | 'processing' | 'done' | 'error';
    videoUrl?: string;
    error?: string;
    title?: string;
    content?: string;
    audioPath?: string;
    audioDuration?: number;
    videoPath?: string;
    videoDuration?: number;
    videoSize?: number;
    videoResolution?: string;
    hasSubtitles?: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const JobSchema: Schema = new Schema({
    url: {
        type: String,
        required: true,
        unique: true
    },
    status: {
        type: String,
        enum: ['pending', 'processing', 'done', 'error'],
        default: 'pending'
    },
    videoUrl: {
        type: String,
        default: null
    },
    error: {
        type: String,
        default: null
    },
    title: {
        type: String,
        default: null
    },
    content: {
        type: String,
        default: null
    },
    audioPath: {
        type: String,
        default: null
    },
    audioDuration: {
        type: Number,
        default: null
    },
    videoPath: {
        type: String,
        default: null
    },
    videoDuration: {
        type: Number,
        default: null
    },
    videoSize: {
        type: Number,
        default: null
    },
    videoResolution: {
        type: String,
        default: null
    },
    hasSubtitles: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

export const Job = mongoose.model<IJob>('Job', JobSchema); 