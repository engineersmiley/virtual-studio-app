import { z } from 'zod';
import { insertRecordingSchema, insertSessionSchema, recordings, sessions } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  sessions: {
    create: {
      method: 'POST' as const,
      path: '/api/sessions',
      input: z.object({ name: z.string() }),
      responses: {
        201: z.custom<typeof sessions.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/sessions/:id',
      responses: {
        200: z.custom<typeof sessions.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    list: {
      method: 'GET' as const,
      path: '/api/sessions',
      responses: {
        200: z.array(z.custom<typeof sessions.$inferSelect>()),
      },
    },
    end: {
      method: 'POST' as const,
      path: '/api/sessions/:id/end',
      responses: {
        200: z.custom<typeof sessions.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
  },
  recordings: {
    list: {
      method: 'GET' as const,
      path: '/api/recordings',
      responses: {
        200: z.array(z.custom<typeof recordings.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/recordings/:id',
      responses: {
        200: z.custom<typeof recordings.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    upload: {
      method: 'POST' as const,
      path: '/api/recordings/upload',
      input: insertRecordingSchema, 
      responses: {
        201: z.custom<typeof recordings.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/recordings/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

// WebSocket events for signaling
export const wsEvents = {
  join: 'join',
  offer: 'offer',
  answer: 'answer',
  iceCandidate: 'ice-candidate',
  leave: 'leave',
  userJoined: 'user-joined',
  userLeft: 'user-left',
  error: 'error',
} as const;
