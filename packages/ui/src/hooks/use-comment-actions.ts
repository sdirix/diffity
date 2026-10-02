import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CommentAuthor, CommentSide, CommentThread } from '../components/comments/types';
import * as api from '../lib/api';
import { replyOnGitHubWithToast, setResolvedWithToast } from '../lib/github-threads';

/** Comment actions. Replies, resolves and reopens of threads in `threads` that are on GitHub go to GitHub too. */
export function useCommentActions(sessionId: string | null, enabled: boolean, threads?: CommentThread[]) {
  const queryClient = useQueryClient();
  const onGitHub = useRef(new Set<string>());
  onGitHub.current = new Set((threads ?? []).filter((thread) => thread.githubThreadId).map((thread) => thread.id));

  const invalidateThreads = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['threads', sessionId] });
  }, [queryClient, sessionId]);

  const addThread = useCallback((filePath: string, side: CommentSide, startLine: number, endLine: number, body: string, author: CommentAuthor, anchorContent?: string) => {
    if (!enabled || !sessionId) {
      return;
    }
    api.createThread({ sessionId, filePath, side, startLine, endLine, body, author, anchorContent }).then(() => {
      invalidateThreads();
    });
  }, [enabled, sessionId, invalidateThreads]);

  const addReply = useCallback((threadId: string, body: string, author: CommentAuthor) => {
    if (!enabled) {
      return;
    }
    if (onGitHub.current.has(threadId)) {
      void replyOnGitHubWithToast(threadId, body, author);
      return;
    }
    api.replyToThread(threadId, body, author).then(() => {
      invalidateThreads();
    });
  }, [enabled, invalidateThreads]);

  const resolveThread = useCallback((threadId: string) => {
    if (!enabled) {
      return;
    }
    if (onGitHub.current.has(threadId)) {
      void setResolvedWithToast(threadId, true);
      return;
    }
    api.updateThreadStatus(threadId, 'resolved').then(() => {
      invalidateThreads();
    });
  }, [enabled, invalidateThreads]);

  const unresolveThread = useCallback((threadId: string) => {
    if (!enabled) {
      return;
    }
    if (onGitHub.current.has(threadId)) {
      void setResolvedWithToast(threadId, false);
      return;
    }
    api.updateThreadStatus(threadId, 'open').then(() => {
      invalidateThreads();
    });
  }, [enabled, invalidateThreads]);

  const dismissThread = useCallback((threadId: string) => {
    if (!enabled) {
      return;
    }
    api.updateThreadStatus(threadId, 'dismissed').then(() => {
      invalidateThreads();
    });
  }, [enabled, invalidateThreads]);

  const editComment = useCallback((commentId: string, body: string) => {
    if (!enabled) {
      return;
    }
    api.editComment(commentId, body).then(() => {
      invalidateThreads();
    });
  }, [enabled, invalidateThreads]);

  const deleteComment = useCallback((threadId: string, commentId: string) => {
    if (!enabled) {
      return;
    }
    api.deleteComment(commentId).then(() => {
      invalidateThreads();
    });
  }, [enabled, invalidateThreads]);

  const deleteThread = useCallback((threadId: string) => {
    if (!enabled) {
      return;
    }
    api.deleteThread(threadId).then(() => {
      invalidateThreads();
    });
  }, [enabled, invalidateThreads]);

  const deleteAllThreads = useCallback(() => {
    if (!enabled || !sessionId) {
      return;
    }
    api.deleteAllThreads(sessionId).then(() => {
      invalidateThreads();
    });
  }, [enabled, sessionId, invalidateThreads]);

  return {
    addThread,
    addReply,
    resolveThread,
    unresolveThread,
    dismissThread,
    editComment,
    deleteComment,
    deleteThread,
    deleteAllThreads,
  };
}

export type CommentActions = ReturnType<typeof useCommentActions>;
