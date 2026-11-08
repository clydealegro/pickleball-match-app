import { fireEvent, render, screen } from '@testing-library/react';
import App from '../ui/App';

/** Renders the app and, when it lands on Home, opens Who's playing as a one-off session. */
export function renderAtSetup() {
  const result = render(<App />);
  const oneOff = screen.queryByRole('button', { name: 'Start a one-off session' });
  if (oneOff) fireEvent.click(oneOff);
  return result;
}
