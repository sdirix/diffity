import { toast } from 'sonner';
import type { CommentAuthor } from '../components/comments/types';
import { postCommentToGitHub, replyOnGitHub, setResolvedOnGitHub } from './api';
import { refreshThreadQueries } from './github-sync';
import { errorMessage } from './toast';

/** Replies on GitHub. A failed reply offers to retry, since the form is gone by then. */
export async function replyOnGitHubWithToast(threadId: string, body: string, author: CommentAuthor): Promise<void> {
  const id = toast.loading('Replying on GitHub…');
  try {
    await replyOnGitHub(threadId, body, author);
    toast.success('Replied on GitHub', { id });
    refreshThreadQueries();
  } catch (error) {
    toast.error('Failed to reply on GitHub', {
      id,
      description: errorMessage(error),
      action: { label: 'Retry', onClick: () => void replyOnGitHubWithToast(threadId, body, author) },
    });
  }
}

export async function setResolvedWithToast(threadId: string, resolved: boolean): Promise<void> {
  const id = toast.loading(resolved ? 'Resolving on GitHub…' : 'Reopening on GitHub…');
  try {
    await setResolvedOnGitHub(threadId, resolved);
    toast.success(resolved ? 'Resolved on GitHub' : 'Reopened on GitHub', { id });
  } catch (error) {
    toast.error(resolved ? 'Failed to resolve on GitHub' : 'Failed to reopen on GitHub', { id, description: errorMessage(error) });
  } finally {
    refreshThreadQueries();
  }
}

export async function postCommentWithToast(commentId: string): Promise<void> {
  const id = toast.loading('Posting to GitHub…');
  try {
    await postCommentToGitHub(commentId);
    toast.success('Posted to GitHub', { id });
    refreshThreadQueries();
  } catch (error) {
    toast.error('Failed to post to GitHub', { id, description: errorMessage(error) });
  }
}
