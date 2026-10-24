'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Studio } from '../components/studio';

const PROJECT_FAMILIES = [
  {
    family: 'Differential-drive indoor rover',
    badge: 'supported',
    tone: '#10b981',
    note: 'End-to-end 2WD ESP32 + TB6612 + range sensor assembly, BOM, wiring, simulation & firmware.',
  },
  {
    family: 'Mini RC car variant',
    badge: 'planned',
    tone: '#f59e0b',
    note: 'Stretch variation reusing rover drive primitives; not enabled until independently verified.',
  },
  {
    family: 'Quadcopter drone / Robot arm',
    badge: 'unsupported (coming later)',
    tone: '#64748b',
    note: 'Flight and articulated manipulator verification are outside v1 scope.',
  },
] as const;

export default function HomePage() {
  const [showIntroStrip, setShowIntroStrip] = useState(true);

  return (
    <div data-testid="home-page">
      {showIntroStrip && (
        <section
          aria-label="Rivet overview and supported hardware scope"
          data-testid="home-scope-strip"
          style={{
            background: '#10141d',
            borderBottom: '1px solid #1f2737',
            padding: '10px 16px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
            <strong style={{ color: '#f8fafc', fontSize: 13 }}>
              Rivet: Inspiration → Component-Backed Hardware Starting Point
            </strong>
            <span style={{ color: '#94a3b8' }}>
              Reference images are interpreted into supported catalog builds, not reverse-engineered with certainty.
            </span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            {PROJECT_FAMILIES.map((f) => (
              <span
                key={f.family}
                title={f.note}
                data-testid={`family-badge-${f.badge.split(' ')[0]}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  background: '#161c28',
                  border: '1px solid #263042',
                  borderRadius: 999,
                  padding: '3px 9px',
                  fontSize: 11,
                  color: '#cbd5e1',
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: f.tone,
                  }}
                />
                <span>{f.family}:</span>
                <strong style={{ color: f.tone }}>{f.badge}</strong>
              </span>
            ))}
            <Link
              href="/studio"
              data-testid="open-studio-link"
              style={{
                background: '#2563eb',
                color: '#ffffff',
                borderRadius: 5,
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Dedicated /studio view
            </Link>
            <button
              type="button"
              onClick={() => setShowIntroStrip(false)}
              aria-label="Dismiss overview strip"
              style={{
                background: 'transparent',
                color: '#94a3b8',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              ✕
            </button>
          </div>
        </section>
      )}

      <Studio />
    </div>
  );
}
