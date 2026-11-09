import { redirect } from 'next/navigation';

/**
 * The M2 Queue Editor became part of the Master View (M3): one editing system for structure,
 * content and planning. This route stays as a permanent alias so links and bookmarks keep working.
 */
export default async function QueueEditorAlias({
  params,
}: {
  params: Promise<{ showId: string }>;
}) {
  const { showId } = await params;
  redirect(`/show/${showId}/master`);
}
