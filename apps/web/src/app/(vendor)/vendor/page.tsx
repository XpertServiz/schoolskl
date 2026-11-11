import { redirect } from 'next/navigation';
import { requireVendor } from '@/lib/auth';

export const metadata = { title: 'Vendor Console', robots: { index: false, follow: false } };

export default async function VendorConsole() {
  await requireVendor(); // non-vendor users never learn this console exists (404)
  redirect('/vendor/tenants');
}
