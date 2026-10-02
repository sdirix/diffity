import { useState, useRef, useEffect } from 'react';
import type { Comment } from './types';
import { PencilIcon } from '../icons/pencil-icon';
import { TrashIcon } from '../icons/trash-icon';
import { UploadIcon } from '../icons/upload-icon';
import { MarkdownContent } from '../layout/markdown-content';
import { useAgentMention } from '../agent/mention-input';

interface CommentBubbleProps {
  comment: Comment;
  onEdit: (body: string) => void;
  onDelete: () => void;
  /** Set for a local comment of a thread that is on GitHub. */
  onPostToGitHub?: () => void;
}

export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffSec < 60) {
    return 'just now';
  }
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  if (diffHr < 24) {
    return `${diffHr}h ago`;
  }
  if (diffDays < 30) {
    return `${diffDays}d ago`;
  }
  return date.toLocaleDateString();
}

function AuthorAvatar(props: { name: string; avatarUrl?: string; type: 'user' | 'agent' }) {
  const { name, avatarUrl, type } = props;

  if (avatarUrl) {
    return (
      <img src={avatarUrl} alt={name} className="w-5 h-5 rounded-full" />
    );
  }

  const bgColor = type === 'agent' ? 'bg-accent' : 'bg-text-muted';
  const initial = name.charAt(0).toUpperCase();

  return (
    <div className={`w-5 h-5 rounded-full ${bgColor} flex items-center justify-center text-white text-[10px] font-medium`}>
      {initial}
    </div>
  );
}

export function CommentBubble(props: CommentBubbleProps) {
  const { comment, onEdit, onDelete, onPostToGitHub } = props;
  const onGitHub = !!comment.githubCommentId;
  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mention = useAgentMention(editBody, setEditBody, textareaRef);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [isEditing]);

  const handleSave = () => {
    const trimmed = editBody.trim();
    if (!trimmed || trimmed === comment.body) {
      setIsEditing(false);
      setEditBody(comment.body);
      return;
    }
    onEdit(trimmed);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditBody(comment.body);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention.onKeyDown(e)) {
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  return (
    <div className="px-1.5 py-1 first:pt-1.5 last:pb-1.5 group">
      <div className="bg-bg rounded-lg px-3 py-2.5">
        <div className="flex items-center gap-2 mb-1.5">
          <AuthorAvatar name={comment.author.name} avatarUrl={comment.author.avatarUrl} type={comment.author.type} />
          <span className="text-xs font-semibold text-text">{comment.author.name}</span>
          {comment.author.type === 'agent' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent font-medium">bot</span>
          )}
          <span className="text-[11px] text-text-muted">{formatRelativeTime(comment.createdAt)}</span>
          {onPostToGitHub && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-tertiary text-text-muted">Local</span>}
          {!isEditing && (
            <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {onPostToGitHub && (
                <button
                  onClick={onPostToGitHub}
                  className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-text cursor-pointer"
                  title="Post this reply on GitHub"
                >
                  <UploadIcon className="w-3 h-3" />
                  Post to GitHub
                </button>
              )}
              {!onGitHub && (
                <button
                  onClick={() => setIsEditing(true)}
                  className="text-text-muted hover:text-text cursor-pointer"
                  title="Edit comment"
                >
                  <PencilIcon className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={onDelete}
                className="text-text-muted hover:text-deleted cursor-pointer"
                title="Delete comment"
              >
                <TrashIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
        <div className="text-sm text-text pl-7">
        {isEditing ? (
          <div>
            <textarea
              ref={textareaRef}
              value={editBody}
              onChange={(e) => {
                setEditBody(e.target.value);
                mention.onCaret();
              }}
              onKeyDown={handleKeyDown}
              onSelect={mention.onCaret}
              onBlur={mention.onBlur}
              rows={3}
              className="w-full px-3 py-2 text-sm bg-bg-tertiary text-text resize-y outline-none rounded-md min-h-[60px]"
            />
            {mention.popup}
            <div className="flex items-center gap-2 mt-1.5">
              <div className="flex-1 min-w-0">{mention.hint}</div>
              <button
                onClick={handleCancel}
                className="px-3 py-1 text-xs font-medium rounded-md text-text-secondary hover:bg-hover transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!editBody.trim()}
                className="px-3 py-1 text-xs font-medium rounded-md bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <MarkdownContent content={comment.body} html={onGitHub} />
        )}
        </div>
      </div>
    </div>
  );
}
