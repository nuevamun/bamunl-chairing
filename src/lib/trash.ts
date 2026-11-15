import { TRASH_DAYS } from './engine';
const day = (t: number) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
/** "Deleted Nov 15 · removed for good Dec 15" */
export const trashNote = (deletedAt: number) => `Deleted ${day(deletedAt)} · removed for good ${day(deletedAt + TRASH_DAYS * 86_400_000)}`;
