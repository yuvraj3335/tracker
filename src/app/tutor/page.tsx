import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/tenant';
import { StudyTutor } from '@/components/study-tutor';

export const metadata = { title: 'Study tutor · Job Switch Tracker' };

export default async function TutorPage({ searchParams }: { searchParams: Promise<{ question?: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/login?next=/tutor');
  const params = await searchParams;
  const question = typeof params.question === 'string' ? params.question.slice(0, 500) : '';
  return <StudyTutor key={question} initialQuestion={question} />;
}
