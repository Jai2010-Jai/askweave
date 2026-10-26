import { Check } from 'lucide-react';

export const ThreeSteps: React.FC = () => {
  const steps = [
    {
      num: '1',
      title: 'Download Weave to your computer',
      desc: 'Free 1-click installer for macOS or Windows. Takes under 30 seconds to download and open.',
      badge: 'macOS & Windows'
    },
    {
      num: '2',
      title: 'Scan the QR code with WhatsApp',
      desc: 'Open WhatsApp on your phone, tap Linked Devices, and point your camera at the screen. Exactly like WhatsApp Web.',
      badge: 'Instant pairing'
    },
    {
      num: '3',
      title: 'Text or voice note anything you need',
      desc: 'Send a message while walking, cooking, or commuting. Weave takes care of it on your computer and texts you back.',
      badge: 'Voice notes welcome'
    }
  ];

  return (
    <section className="py-12 border-t border-[#ead6cd]/70 max-w-3xl mx-auto font-sans" id="how-it-works">
      <div className="flex flex-col gap-2 mb-8">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1d110c]">
          How it works
        </h2>
        <p className="text-base text-[#59534E]">
          Up and running in two minutes. If you know how to use WhatsApp Web, you already know how to use Weave.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {steps.map((step, idx) => (
          <div
            key={idx}
            className="flex flex-col justify-between rounded-2xl border border-[#ead6cd] bg-white p-6 shadow-xs"
          >
            <div className="space-y-3">
              <div className="size-8 rounded-full bg-[#ff5100]/10 text-[#ff5100] flex items-center justify-center font-bold text-sm">
                {step.num}
              </div>
              <h3 className="text-base font-bold text-[#1d110c] leading-snug">
                {step.title}
              </h3>
              <p className="text-xs sm:text-sm text-[#59534E] leading-relaxed">
                {step.desc}
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-[#f4ebe6] flex items-center gap-1.5 text-xs text-emerald-800 font-medium">
              <Check className="size-3.5 text-emerald-600" />
              <span>{step.badge}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
