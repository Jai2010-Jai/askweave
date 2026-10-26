import { Download, QrCode, MessageSquareHeart, Check } from 'lucide-react';

export const HowItWorksSection: React.FC = () => {
  const steps = [
    {
      step: '01',
      icon: <Download className="size-6 text-[#ff5100]" />,
      title: 'Download Weave on your PC',
      description: 'Install Weave on your Mac or Windows laptop or desktop computer. It takes less than 30 seconds and is completely free.',
      highlight: '1-click installer'
    },
    {
      step: '02',
      icon: <QrCode className="size-6 text-[#ff5100]" />,
      title: 'Scan QR Code with WhatsApp',
      description: 'Open WhatsApp on your phone, tap Linked Devices, and point your camera at the screen. Exactly like logging into WhatsApp Web.',
      highlight: 'No account needed'
    },
    {
      step: '03',
      icon: <MessageSquareHeart className="size-6 text-[#ff5100]" />,
      title: 'Text or Speak Anything',
      description: 'Send a quick text or voice note from anywhere in the world. Weave does the work on your computer and texts you the results.',
      highlight: 'Voice notes supported'
    }
  ];

  return (
    <section className="flex flex-col gap-8 py-8 border-t border-[#ead6cd] font-sans" id="how-it-works">
      <div className="flex flex-col gap-2 max-w-2xl">
        <span className="text-xs font-bold tracking-wider uppercase text-[#ff5100]">
          SIMPLE 3-STEP SETUP
        </span>
        <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-[#1d110c]">
          Up and running in 2 minutes.
        </h2>
        <p className="text-sm sm:text-base text-[#59534E] leading-relaxed">
          If you know how to use WhatsApp Web, you already know how to use Weave. No learning curve, no tech skills needed.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {steps.map((item, idx) => (
          <div
            key={idx}
            className="flex flex-col justify-between rounded-2xl border border-[#ead6cd] bg-[#fcf9f8] p-6 hover:shadow-sm transition-all relative overflow-hidden"
          >
            {/* Step Number in Background */}
            <span className="absolute -top-2 -right-1 text-7xl font-black text-[#f4ebe6] select-none pointer-events-none">
              {item.step}
            </span>

            <div className="flex flex-col gap-4 relative z-10">
              <div className="size-12 rounded-xl bg-[#f4ebe6] border border-[#ead6cd] flex items-center justify-center">
                {item.icon}
              </div>

              <div className="space-y-2">
                <span className="text-xs font-bold text-[#ff5100] uppercase tracking-wider">
                  Step {item.step}
                </span>
                <h3 className="text-lg font-bold text-[#1d110c]">
                  {item.title}
                </h3>
                <p className="text-sm text-[#59534E] leading-relaxed">
                  {item.description}
                </p>
              </div>
            </div>

            <div className="mt-5 pt-3 border-t border-[#f4ebe6] flex items-center gap-1.5 text-xs text-emerald-800 font-semibold relative z-10">
              <Check className="size-4 text-emerald-600" />
              <span>{item.highlight}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
