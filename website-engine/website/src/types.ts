export interface TerminalLog {
  id: string;
  time: string;
  level: 'info' | 'success' | 'warn' | 'dim' | 'accent';
  message: string;
}

export interface PhaseItem {
  id: string;
  number: string;
  title: string;
  subtitle: string;
  description: string;
  status: string;
  techBadge: string;
}

export interface MetricItem {
  id: string;
  value: string;
  label: string;
  description: string;
  highlight: string;
}
