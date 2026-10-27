import type { Metadata } from "next";
import { LegalShell } from "@/components/LegalShell";

export const metadata: Metadata = {
  title: "Terms & Conditions · Weave",
  description: "The terms for using Weave, the AI builder you use through WhatsApp.",
  alternates: { canonical: "/terms" },
};

const EMAIL = "buildwithweave@gmail.com";

export default function TermsPage() {
  return (
    <LegalShell title="Terms & Conditions" updated="24 October 2026">
      <div className="legal-summary">
        <p>
          <b>The short version.</b> Weave is an early-stage AI builder. Use it for good, check what it makes before you
          rely on it, and don&apos;t use it to build anything illegal or harmful. Apps are test builds and websites are
          simple single pages. It&apos;s offered as is, and things can go wrong.
        </p>
      </div>

      <h2>1. Agreeing to these terms</h2>
      <p>
        These terms apply when you use Weave through WhatsApp, SMS, the web chat, voice notes, the Weave phone app or this
        website (together, the &quot;Service&quot;). Weave is run by an individual based in India (&quot;we&quot;,
        &quot;us&quot;). By using the Service you agree to these terms and to our <a href="/privacy">Privacy Policy</a>. If
        you don&apos;t agree, please don&apos;t use Weave.
      </p>

      <h2>2. Who can use Weave</h2>
      <p>
        Anyone can use Weave. If you use Weave for a business, you confirm you&apos;re allowed to accept these terms on its behalf.
      </p>
      <h3>Waitlist accounts</h3>
      <ul>
        <li>
          When you join the waitlist on this website you create an account with your email and a password. Keep your
          details accurate and your password to yourself. You&apos;re responsible for what happens under your account.
        </li>
        <li>
          Joining the waitlist, and your place in line, <b>don&apos;t guarantee access</b> to Weave or any date when
          access will open.
        </li>
        <li>
          You can delete your account at any time from your account page. We may remove accounts that break these terms
          or that were created with false or automated details.
        </li>
      </ul>

      <h2>3. What Weave does, and what it doesn&apos;t</h2>
      <ul>
        <li>
          Weave uses AI to build <b>Android apps</b> and <b>single-page websites</b> from your messages.
        </li>
        <li>
          Android apps are <b>test builds</b> (debug-signed). They install on your phone but are not Play Store releases.
          You install them at your own choice and risk.
        </li>
        <li>
          Apps can&apos;t use the internet, extra libraries or images, and they store data only on your device. Websites
          are static pages without logins, payments, databases or working forms.
        </li>
        <li>
          Weave checks that an app builds and passes its safety checks, but apps are <b>not automatically tested</b> for
          every way you might use them. Review what you get before relying on it.
        </li>
        <li>
          Builds take minutes and can fail. If Weave can&apos;t build something, it will tell you rather than hand over a
          fake result.
        </li>
      </ul>

      <h2>4. Acceptable use</h2>
      <p>You agree not to use Weave to create, request or share anything that:</p>
      <ul>
        <li>is illegal, or helps someone break the law;</li>
        <li>is malware, spyware, or designed to harm devices, data or people;</li>
        <li>impersonates a real person, brand or organisation, or is meant to trick people (for example phishing pages);</li>
        <li>collects other people&apos;s passwords, payment or personal details without their clear consent;</li>
        <li>infringes someone else&apos;s copyright, trademark or other rights;</li>
        <li>is hateful, harassing, sexually explicit involving minors, or promotes violence.</li>
      </ul>
      <p>You also agree not to:</p>
      <ul>
        <li>try to get around Weave&apos;s safety rules, limits or access codes;</li>
        <li>overload, attack or interfere with the Service;</li>
        <li>use Weave to build a competing service by copying it, or resell access without our permission.</li>
      </ul>
      <p>We may refuse requests, remove content or stop builds that break these rules.</p>

      <h2>5. Your content and what Weave makes</h2>
      <ul>
        <li>
          You keep any rights you have in what you send to Weave, such as your ideas, text and voice notes.
        </li>
        <li>
          You give us permission to use that content only to run the Service: understanding your request, building your
          project, and sending you results.
        </li>
        <li>
          As far as the law allows, you own the apps and websites Weave makes for you, and you can use them however you
          like within these terms. AI can produce work similar to what others receive, so we can&apos;t promise your
          result is unique.
        </li>
        <li>
          You&apos;re responsible for what you publish or share. That includes making sure you have the rights to any
          names, text or brands you ask Weave to use.
        </li>
      </ul>

      <h2>6. Publishing websites</h2>
      <p>
        Website previews are private by default. A site only goes on the public internet if you confirm by typing{" "}
        <b>PUBLISH</b>. Once published, you&apos;re responsible for its content, and it&apos;s also subject to the hosting
        provider&apos;s terms.
      </p>

      <h2>7. Other services</h2>
      <p>
        Weave works through services such as WhatsApp, Twilio, Google Gemini, Cloudflare and Netlify. Your use of those
        services is also covered by their own terms. We&apos;re not responsible for outages or changes on their side.
      </p>

      <h2>8. Changes and availability</h2>
      <p>
        Weave is in active development. We may change, pause or stop any part of the Service at any time, and we
        don&apos;t guarantee it will always be available. If we ever introduce paid features, we&apos;ll tell you
        before you&apos;re charged anything.
      </p>

      <h2>9. Suspension</h2>
      <p>
        We may suspend or stop your access if you break these terms, misuse the Service, or put others at risk. You can
        stop using Weave at any time and ask us to delete your data (see the <a href="/privacy">Privacy Policy</a>).
      </p>

      <h2>10. No warranty</h2>
      <p>
        The Service and everything it produces are provided <b>&quot;as is&quot; and &quot;as available&quot;</b>,
        without warranties of any kind, including that it will be error-free, secure, or fit for a particular purpose.
        AI can make mistakes, so check anything important yourself.
      </p>

      <h2>11. Limitation of liability</h2>
      <p>
        To the fullest extent the law allows, we&apos;re not liable for any indirect, incidental or consequential losses,
        or for lost data, profits or business, arising from your use of Weave or anything it builds. Our total liability
        for any claim is limited to ₹1,000 or the amount you paid us in the past 12 months, whichever is higher. Nothing
        in these terms limits liability that can&apos;t be limited by law.
      </p>

      <h2>12. Indemnity</h2>
      <p>
        If someone makes a claim against us because of content you created or published with Weave, or because you broke
        these terms, you agree to cover the reasonable costs of that claim.
      </p>

      <h2>13. Governing law</h2>
      <p>
        These terms are governed by the laws of India. Any dispute will be handled by the courts of Bengaluru, Karnataka.
        Before going to court, please email us so we can try to sort it out.
      </p>

      <h2>14. Changes to these terms</h2>
      <p>
        We may update these terms. We&apos;ll change the date at the top, and tell you through Weave or this website about
        significant changes. Continuing to use Weave after a change means you accept the new terms.
      </p>

      <h2>15. Contact</h2>
      <p>
        <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
      </p>
    </LegalShell>
  );
}
