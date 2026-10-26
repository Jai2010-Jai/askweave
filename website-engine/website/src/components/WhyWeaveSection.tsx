import { Smartphone, Mic, Lock } from 'lucide-react';

export const WhyWeaveSection: React.FC = () => {
  const reasons = [
    {
      icon: <Lock className="size-6 text-emerald-600" />,
      title: '100% Private & On Your PC',
      subtitle: 'Your data never leaves your computer',
      description: 'Unlike big tech cloud assistants that upload your messages and photos to their servers, Weave runs completely on your physical laptop. Your personal files, credit cards, and logins stay 100% private to you.'
    },
    {
      icon: <Smartphone className="size-6 text-[#ff5100]" />,
      title: 'Zero New Apps to Install',
      subtitle: 'Works on the WhatsApp you already use',
      description: 'No extra apps eating your phone memory or asking for new subscriptions. You already have WhatsApp on your home screen. Chatting with Weave feels as natural as texting a friend.'
    },
    {
      icon: <Mic className="size-6 text-[#ff5100]" />,
      title: 'Voice Notes Welcome',
      subtitle: 'Talk naturally while on the go',
      description: 'Too busy to type? Walking the dog, cooking, or driving? Just press and hold the voice message button. Weave listens, transcribes your voice note instantly, and takes care of the task.'
    }
  ];

  return (
    <section className="flex flex-col gap-8 py-8 border-t border-[#ead6cd] font-sans" id="why-weave">
      <div className="flex flex-col gap-2 max-w-2xl">
        <span className="text-xs font-bold tracking-wider uppercase text-[#ff5100]">
          DESIGNED FOR REAL HUMANS
        </span>
        <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-[#1d110c]">
          Why you'll love using Weave every day.
        </h2>
        <p className="text-sm sm:text-base text-[#59534E] leading-relaxed">
          Smart AI that actually respects your privacy, your time, and the apps you already love.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {reasons.map((reason, idx) => (
          <div
            key={idx}
            className="flex flex-col gap-4 rounded-2xl border border-[#ead6cd] bg-[#fcf9f8] p-6 hover:shadow-sm transition-all"
          >
            <div className="size-12 rounded-xl bg-[#f4ebe6] border border-[#ead6cd] flex items-center justify-center">
              {reason.icon}
            </div>

            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-[#1d110c]">
                {reason.title}
              </h3>
              <div className="text-xs font-bold text-[#ff5100]">
                {reason.subtitle}
              </div>
              <p className="text-sm text-[#59534E] leading-relaxed pt-1">
                {reason.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
