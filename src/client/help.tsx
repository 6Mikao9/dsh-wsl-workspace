/**
 * The dialog's "?" help panel: what this build is compatible with, how the
 * plugin is used, and the limits it cannot fix.
 *
 * The compatibility list is not hard-coded: it is read from this plugin's own
 * `package.json` through the host route, so the panel can never advertise a
 * release the build does not declare (and a host that cannot answer simply
 * shows no list).
 */

import type * as React from 'react'
import type { WslSelfDescription } from './api.ts'

/** Props for the help panel. */
export interface WslHelpProps {
  /** Translate a `wslWorkspace` dictionary key. */
  t: (key: string, params?: Record<string, unknown>) => string
  /** Host-reported self-description, or null while it is unknown. */
  description: WslSelfDescription | null
}

/**
 * Split one dictionary entry into its bullet lines.
 * @param value - the multi-line dictionary string.
 * @returns the non-empty lines, trimmed.
 */
function bullets(value: string): string[] {
  return value
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
}

/** One titled section of the panel. */
function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="dww-help-section">
      <h3 className="dww-help-title">{title}</h3>
      {children}
    </section>
  )
}

/**
 * Render the help panel shown behind the dialog's "?" button.
 * @param props - translate function plus the host's self-description.
 */
export function WslHelp({ t, description }: WslHelpProps): React.ReactElement {
  const releases = description?.releases ?? []
  const version = description === null
    ? t('help.compat.unknown')
    : `${t('help.compat.versionLabel')} v${description.version}`
  return (
    <div className="dww-help" role="region" aria-label={t('help.button')}>
      <Section title={t('help.compat.title')}>
        <div className="dww-help-meta">{version}</div>
        {releases.length > 0
          ? (
            <div className="dww-help-chips">
              {releases.map(entry => <span key={entry.id} className="dww-help-chip">{entry.id}</span>)}
            </div>
          )
          : null}
        <ul className="dww-help-list">
          {bullets(t('help.compat.body')).map(line => <li key={line}>{line}</li>)}
        </ul>
      </Section>
      <Section title={t('help.usage.title')}>
        <ul className="dww-help-list">
          {bullets(t('help.usage.body')).map(line => <li key={line}>{line}</li>)}
        </ul>
      </Section>
      <Section title={t('help.known.title')}>
        <ul className="dww-help-list dww-help-list--known">
          {bullets(t('help.known.body')).map(line => <li key={line}>{line}</li>)}
        </ul>
      </Section>
      <div className="dww-help-footer">
        <a className="dww-help-link" href="https://www.npmjs.com/package/dsh-wsl-workspace" target="_blank" rel="noreferrer">
          {t('help.footer.npm')}
        </a>
        <a className="dww-help-link" href="https://github.com/6Mikao9/dsh-wsl-workspace" target="_blank" rel="noreferrer">
          {t('help.footer.repo')}
        </a>
      </div>
    </div>
  )
}
