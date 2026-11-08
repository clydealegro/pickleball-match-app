import { fireEvent, render, screen } from '@testing-library/react';
import App from '../ui/App';

/** On Home, picks the one-off chip and starts it, which opens Who's playing with no plan. */
export function openOneOff() {
  fireEvent.click(screen.getByRole('radio', { name: 'One-off session' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start a one-off session' }));
}

/** Renders the app and, when it lands on Home, opens Who's playing as a one-off session. */
export function renderAtSetup() {
  const result = render(<App />);
  if (screen.queryByRole('radio', { name: 'One-off session' })) openOneOff();
  return result;
}
