import { SignIn } from '@clerk/nextjs';
export default function Page() {
  return <div className="min-h-screen grid place-items-center bg-[#f6f8f6]"><SignIn /></div>;
}
