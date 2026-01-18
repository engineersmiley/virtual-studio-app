import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { recordings, type InsertRecording } from "@shared/schema";
import { z } from "zod";

// Fetch list of recordings
export function useRecordings() {
  return useQuery({
    queryKey: [api.recordings.list.path],
    queryFn: async () => {
      const res = await fetch(api.recordings.list.path);
      if (!res.ok) throw new Error("Failed to fetch recordings");
      return api.recordings.list.responses[200].parse(await res.json());
    },
  });
}

// Fetch single recording
export function useRecording(id: number) {
  return useQuery({
    queryKey: [api.recordings.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.recordings.get.path, { id });
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch recording");
      return api.recordings.get.responses[200].parse(await res.json());
    },
  });
}

// Upload new recording
export function useUploadRecording() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ blob, metadata }: { blob: Blob, metadata: Omit<InsertRecording, "filename" | "fileSize" | "mimeType"> }) => {
      const formData = new FormData();
      // Filename will be generated on server or refined here, but we pass a name
      formData.append("file", blob, `${metadata.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.webm`);
      formData.append("title", metadata.title);
      if (metadata.description) formData.append("description", metadata.description);
      formData.append("duration", metadata.duration.toString());

      const res = await fetch(api.recordings.upload.path, {
        method: api.recordings.upload.method,
        body: formData,
        // Don't set Content-Type header manually for FormData, browser does it with boundary
      });

      if (!res.ok) {
        if (res.status === 400) {
          const error = api.recordings.upload.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        throw new Error("Failed to upload recording");
      }
      return api.recordings.upload.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.recordings.list.path] });
    },
  });
}

// Delete recording
export function useDeleteRecording() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.recordings.delete.path, { id });
      const res = await fetch(url, { method: api.recordings.delete.method });
      if (res.status === 404) throw new Error("Recording not found");
      if (!res.ok) throw new Error("Failed to delete recording");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.recordings.list.path] });
    },
  });
}
