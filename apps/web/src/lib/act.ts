import { revalidatePath } from 'next/cache';
import { done, fail } from './portal';
import { supabaseServer } from './supabase/server';

type Sb = Awaited<ReturnType<typeof supabaseServer>>;
type Res = { error: { message: string } | null };

/**
 * One line for the usual server action: run a database call as the signed-in person, then come back with ?ok= or ?err=.
 * The database does the permission check; this only carries the answer back.
 */
export async function act(here: string, okMessage: string, fn: (sb: Sb) => PromiseLike<Res>): Promise<never> {
  const sb = await supabaseServer();
  const { error } = await fn(sb);
  if (error) return fail(here, error);
  revalidatePath(here);
  return done(here, okMessage);
}

export const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
