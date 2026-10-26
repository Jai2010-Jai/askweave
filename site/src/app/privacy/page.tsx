import type { Metadata } from "next";
import { LegalShell } from "@/components/LegalShell";

export const metadata: Metadata = {
  title: "Privacy Policy · Weave",
  description: "How Weave handles your messages, voice notes and the apps and websites it builds for you.",
  alternates: { canonical: "/privacy" },
};

const EMAIL = "buildwithweave@gmail.com";

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="24 October 2026">
      <div className="legal-summary">
        <p>
          <b>The short version.</b> Weave builds apps and websites from the messages you send it. To do that it has to
          read those messages, and it sends the text of your requests to Google&apos;s Gemini AI. Voice notes are
          transcribed on Weave&apos;s own computer, not by a cloud service. If you join the waitlist, we keep your
          name, email and what you&apos;d like to build. We don&apos;t sell your data, we don&apos;t run ads, and this
          website doesn&apos;t use tracking cookies or analytics.
        </p>
      </div>

      <h2>1. Who we are</h2>
      <p>
        Weave (&quot;Weave&quot;, &quot;we&quot;, &quot;us&quot;) is an AI builder you use through WhatsApp, text message
        (SMS), a mobile web chat or voice notes. It is run by an individual based in India. This policy covers the Weave
        service and this website, askweave.xyz.
      </p>
      <p>
        Questions or requests about your data: <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.
      </p>

      <h2>2. What we collect</h2>
      <h3>When you use Weave</h3>
      <ul>
        <li>
          <b>Your phone number or chat identifier</b>, so replies, progress updates and links go back to the right
          conversation.
        </li>
        <li>
          <b>Your messages</b>, for example “make me a habit tracker” or “make it dark”, and the conversation history
          Weave needs to keep working on the same project.
        </li>
        <li>
          <b>Voice notes</b> you send. They are converted to text on Weave&apos;s own computer using Whisper speech
          recognition. The audio isn&apos;t sent to a cloud transcription service.
        </li>
        <li>
          <b>What Weave builds for you</b>: the app code, the finished Android app files, website pages, earlier
          versions, and build logs.
        </li>
        <li>
          <b>Basic technical records</b>, such as when a message arrived and whether a build succeeded, used to run the
          service and fix problems.
        </li>
      </ul>
      <h3>When you join the waitlist</h3>
      <ul>
        <li>
          <b>Your name, email address and password.</b> Your password is stored only in a scrambled (hashed) form by our
          login provider, so nobody, including us, can read it.
        </li>
        <li>
          <b>What you&apos;d like to build first</b>, if you choose to tell us.
        </li>
        <li>
          <b>The language you were using</b> on this site and <b>when you joined</b>, which sets your place in line.
        </li>
        <li>
          <b>Your invite code</b>, and the code of whoever invited you if you joined through their link. They only see
          how many people joined with their link, never who.
        </li>
      </ul>
      <p>
        We use these to keep your place on the waitlist, let you log in to see it, and email you about your access to
        Weave and important changes to your account. We don&apos;t send marketing emails unrelated to Weave.
      </p>
      <h3>When you visit this website</h3>
      <ul>
        <li>
          This website has <b>no tracking cookies and no analytics</b>.
        </li>
        <li>
          Your browser remembers your <b>language</b>, <b>light or dark mode</b>, and whether you&apos;ve already seen
          the opening animation. This is stored only in your own browser (local and session storage) and is never sent
          to us.
        </li>
        <li>
          If you log in, your browser also stores a <b>login session</b> in local storage so you stay logged in. Logging
          out removes it.
        </li>
        <li>
          Our hosting provider, Netlify, keeps standard server logs (such as IP address, browser type and the pages
          requested) to deliver and protect the site.
        </li>
      </ul>

      <h2>3. How we use it</h2>
      <ul>
        <li>To understand what you asked for and build the app or website.</li>
        <li>To send you progress updates, results and links.</li>
        <li>To let you keep changing the same project over later messages.</li>
        <li>To keep the service secure, prevent abuse and fix problems.</li>
      </ul>
      <p>
        We do <b>not</b> sell your information, use it for advertising, or share it with data brokers.
      </p>

      <h2>4. Services we rely on</h2>
      <p>Weave uses a few outside services. Each handles data under its own privacy terms:</p>
      <ul>
        <li>
          <b>WhatsApp (Meta)</b> carries your WhatsApp messages.
        </li>
        <li>
          <b>Twilio</b> connects Weave to WhatsApp and SMS, so it handles the messages and phone numbers passing through.
        </li>
        <li>
          <b>Google Gemini API</b> receives the text of your requests (and related project details) so the AI can write
          your app or website.
        </li>
        <li>
          <b>Cloudflare</b> provides a secure connection between your phone and Weave for the web chat and phone app.
        </li>
        <li>
          <b>Supabase</b> stores the waitlist and handles logins and the account emails (confirmation and password
          reset).
        </li>
        <li>
          <b>Netlify</b> hosts this website. It also hosts a website you build, but only if you choose to publish it.
        </li>
      </ul>

      <h2>5. Your links and published sites</h2>
      <ul>
        <li>
          Download and preview links are <b>secret, expire, and only work a limited number of times</b>. Anyone you
          forward a link to can open it while it&apos;s still valid, so share links with care.
        </li>
        <li>
          A website preview is private by default. It only goes on the public internet if you clearly confirm by typing{" "}
          <b>PUBLISH</b>. Once published, anything on that site is public.
        </li>
        <li>
          Don&apos;t put personal or sensitive information into an app or site you plan to share or publish.
        </li>
      </ul>

      <h2>6. How long we keep it</h2>
      <p>
        We keep conversations and projects for as long as they&apos;re needed to provide the service, including making
        later changes to your project. Waitlist details are kept until you delete your account or ask us to, or until
        we close the waitlist. You can ask us to delete your data at any time (see section 8). Expired links stop
        working, even if the project is still stored.
      </p>

      <h2>7. How we protect it</h2>
      <ul>
        <li>The secret key that powers the AI is never sent to your phone, put into your apps, or written to logs.</li>
        <li>The AI can only write app code. It can&apos;t change build settings, add phone permissions or access the internet.</li>
        <li>Connecting a phone needs a 16-character access code, and repeated wrong attempts block that device for a while.</li>
      </ul>
      <p>
        No system is perfectly secure, but we work to protect your information and will act quickly if something goes
        wrong.
      </p>

      <h2>8. Your choices and rights</h2>
      <p>
        Under India&apos;s Digital Personal Data Protection Act, 2023 and similar laws, you can ask us to:
      </p>
      <ul>
        <li>tell you what information we hold about you,</li>
        <li>correct or update it,</li>
        <li>delete it, and</li>
        <li>stop processing it (which may mean we can&apos;t keep building for you).</li>
      </ul>
      <p>
        If you joined the waitlist, you can see and change your details, and <b>delete your account</b>, yourself on your{" "}
        <a href="/account">account page</a>. For anything else,
        email <a href={`mailto:${EMAIL}`}>{EMAIL}</a> from the same phone number or account you used, or tell us which
        number it was, so we can find your data. If you&apos;re not satisfied with our response, you can contact the Data
        Protection Board of India.
      </p>

      <h2>9. Where your data is processed</h2>
      <p>
        Weave is operated from India, but the outside services in section 4 may process data in other countries, under their own
        safeguards.
      </p>

      <h2>10. Changes to this policy</h2>
      <p>
        If we change this policy, we&apos;ll update the date at the top of this page. If the change is significant,
        we&apos;ll also tell you through Weave or on this website.
      </p>

      <h2>11. Contact</h2>
      <p>
        <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
      </p>
    </LegalShell>
  );
}
