import { redirect } from 'next/navigation';

// Old bookmarks lead back to the tracker, where Miso owns the conversation.
export default function TutorPage() { redirect('/areas/dsa'); }
