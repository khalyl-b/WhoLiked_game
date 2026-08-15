import Link from "next/link";

const operator = process.env.NEXT_PUBLIC_OPERATOR_NAME;
const contact = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;

export default function TermsPage() {
  return <main className="shell py-10 sm:py-14"><article className="mx-auto max-w-3xl">
    <Link href="/" className="text-sm font-bold text-zinc-400 hover:text-white">← Home</Link>
    <h1 className="mt-5 text-4xl font-black sm:text-5xl">Terms of Service</h1>
    <p className="mt-3 text-sm text-zinc-500">Last updated: 15 August 2026</p>
    <div className="mt-8 space-y-8 text-zinc-300 leading-7">
      <section><h2 className="text-xl font-black text-white">Operator</h2>{operator ? <p className="mt-2">These terms are between you and {operator}, the operator of Who Liked That?.</p> : <p className="mt-2 text-amber-200">Set <code>NEXT_PUBLIC_OPERATOR_NAME</code> to the genuine person or organisation operating the service before production review.</p>}</section>
      <section><h2 className="text-xl font-black text-white">1. Service</h2><p className="mt-2">Who Liked That? provides a private social guessing game in which invited players can use room codes to play together. Features may be updated over time as the service develops.</p></section>
      <section><h2 className="text-xl font-black text-white">2. Eligibility and accounts</h2><p className="mt-2">You must be permitted to use TikTok and any connected third-party services under their applicable terms. You are responsible for activity performed through your browser session and for keeping access to your devices secure.</p></section>
      <section><h2 className="text-xl font-black text-white">3. TikTok connection and imported data</h2><p className="mt-2">TikTok is a third-party service and is not operated by this application. Connecting TikTok does not transfer ownership of your TikTok content or activity. The application will only request scopes and data required for features you choose to use. Availability of TikTok integration features depends on TikTok approvals, APIs and regional availability.</p></section>
      <section><h2 className="text-xl font-black text-white">4. Acceptable use</h2><p className="mt-2">Do not use the service to harass others, unlawfully access another person's account or data, interfere with the service, evade security controls, submit malicious files, or use room content for unlawful purposes. Do not upload a TikTok data archive that does not belong to you or that you are not authorised to process.</p></section>
      <section><h2 className="text-xl font-black text-white">5. Private-room conduct</h2><p className="mt-2">The game may reveal surprising or embarrassing interests among friends. Players are responsible for choosing who they invite and for treating one another appropriately. A private room code should only be shared with intended participants.</p></section>
      <section><h2 className="text-xl font-black text-white">6. Availability</h2><p className="mt-2">The service is provided on an as-available basis. Features may be interrupted by deployment, maintenance, third-party outages, API changes or approval restrictions. No guarantee is made that a particular TikTok activity item will remain accessible.</p></section>
      <section><h2 className="text-xl font-black text-white">7. Deletion and termination</h2><p className="mt-2">You can disconnect TikTok and delete imported TikTok activity using the Account controls. Access may be restricted or terminated where necessary to protect users, comply with law or third-party platform requirements, or respond to abuse.</p></section>
      <section><h2 className="text-xl font-black text-white">8. Third-party services</h2><p className="mt-2">Use of TikTok, Supabase, Vercel and other third-party services may also be governed by their own terms. This application is not responsible for changes those services make to their APIs, availability or policies.</p></section>
      <section><h2 className="text-xl font-black text-white">9. Contact</h2>{contact ? <p className="mt-2">Support enquiries: <a className="underline" href={`mailto:${contact}`}>{contact}</a>.</p> : <p className="mt-2 text-amber-200">A public support email must be configured before production review. Set <code>NEXT_PUBLIC_SUPPORT_EMAIL</code> in Vercel.</p>}</section>
    </div>
  </article></main>;
}
