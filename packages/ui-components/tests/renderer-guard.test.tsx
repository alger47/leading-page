/**
 * Renderer guard: sanitizeHref neutralizes hostile URLs at render time (Phase 14 §12.3).
 * Even if L1 validation is bypassed, a malicious href can never leave this layer
 * as an active link.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Header } from '../src/sections/Header';
import { Footer } from '../src/sections/Footer';
import { Button } from '../src/primitives/Button';

describe('sanitizeHref renderer guard', () => {
  it('Button neutralizes a javascript: href', () => {
    render(<Button label="Click me" href="javascript:alert(document.cookie)" />);
    const link = screen.getByRole('link', { name: 'Click me' });
    expect(link.getAttribute('href')).toBe('#');
  });

  it('Header nav neutralizes a data: href', () => {
    render(
      <Header
        id="test"
        content={{
          brandName: 'Test',
          nav: [{ label: 'Bad', href: 'data:text/html,<script>x</script>' }],
        }}
      />,
    );
    const link = screen.getByText('Bad');
    expect(link.getAttribute('href')).toBe('#');
  });

  it('Footer link neutralizes a javascript: href', () => {
    render(
      <Footer
        content={{
          brandName: 'Test',
          links: [{ label: 'Bad', href: 'javascript:void(0)' }],
        }}
      />,
    );
    const link = screen.getByText('Bad');
    expect(link.getAttribute('href')).toBe('#');
  });

  it('Footer social neutralizes a hostile url', () => {
    render(
      <Footer
        content={{
          brandName: 'Test',
          links: [],
          social: [{ platform: 'evil', url: 'javascript:alert(1)' }],
        }}
      />,
    );
    const link = screen.getByText('evil');
    expect(link.getAttribute('href')).toBe('#');
  });

  it('passes safe hrefs through untouched', () => {
    render(<Button label="Go" href="https://example.com" />);
    expect(screen.getByRole('link', { name: 'Go' }).getAttribute('href')).toBe('https://example.com');
  });
});
