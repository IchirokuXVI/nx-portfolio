import { MEMORY_OPERATOR_SETTINGS } from '@portfolio/velista/data-access';
import type { OperatorSettings } from '@portfolio/velista/models';
import type { LegalDocument } from './legal-document';
import {
  legalDocumentProblems,
  renderLegalDocument,
  type LegalBlockView,
} from './render';

const LINKS = { privacy: '/en/privacy', terms: '/en/terms' };

/** The memory deployment, with some of it changed. */
function settings(
  change: (base: OperatorSettings) => Partial<OperatorSettings> = () => ({})
): OperatorSettings {
  return { ...MEMORY_OPERATOR_SETTINGS, ...change(MEMORY_OPERATOR_SETTINGS) };
}

function doc(sections: LegalDocument['sections']): LegalDocument {
  return { templateVersion: '2026-10-29', title: 'Privacy Policy', sections };
}

function paragraph(
  text: string,
  when?: LegalDocument['sections'][number]['when']
) {
  return when === undefined
    ? { kind: 'paragraph' as const, text }
    : { kind: 'paragraph' as const, text, when };
}

describe('renderLegalDocument (velista 0172, target 4)', () => {
  it('drops a section whose feature is off, and draws it when on', () => {
    const input = doc([
      { id: 'who', heading: 'Who', blocks: [paragraph('Run by us.')] },
      {
        id: 'voice',
        when: 'transcription',
        heading: 'Voice',
        blocks: [paragraph('On our servers.')],
      },
    ]);

    const off = renderLegalDocument(
      input,
      settings((base) => ({
        features: { ...base.features, transcription: false },
      })),
      LINKS
    );
    const on = renderLegalDocument(input, settings(), LINKS);

    expect(off.sections.map((section) => section.id)).toEqual(['who']);
    expect(on.sections.map((section) => section.id)).toEqual(['who', 'voice']);
  });

  it('draws an operator value holding markup as its characters', () => {
    const view = renderLegalDocument(
      doc([
        {
          id: 'who',
          heading: 'Who',
          blocks: [paragraph('{{appName}} is run by {{controllerName}}.')],
        },
      ]),
      settings(() => ({ controllerName: '<b>Example</b>' })),
      LINKS
    );

    expect(view.sections[0].blocks[0]).toEqual({
      kind: 'paragraph',
      runs: [
        {
          kind: 'text',
          text: 'Example Shopper is run by <b>Example</b>.',
        },
      ],
    });
  });

  it('makes every contact address a mail link', () => {
    const view = renderLegalDocument(
      doc([
        {
          id: 'rights',
          heading: 'Rights',
          blocks: [
            paragraph('Write to {{contactEmail}}, or {{contactEmail}} again.'),
          ],
        },
      ]),
      settings(),
      LINKS
    );

    expect(view.sections[0].blocks[0]).toEqual({
      kind: 'paragraph',
      runs: [
        { kind: 'text', text: 'Write to ' },
        { kind: 'email', email: 'privacy@example.org' },
        { kind: 'text', text: ', or ' },
        { kind: 'email', email: 'privacy@example.org' },
        { kind: 'text', text: ' again.' },
      ],
    });
  });

  it('turns the two link tokens into links to the other document', () => {
    const view = renderLegalDocument(
      doc([
        {
          id: 'accept',
          heading: 'Accept',
          blocks: [paragraph('See the [[privacy]] and the [[terms]].')],
        },
      ]),
      settings(),
      LINKS
    );

    expect(view.sections[0].blocks[0]).toEqual({
      kind: 'paragraph',
      runs: [
        { kind: 'text', text: 'See the ' },
        { kind: 'link', document: 'privacy', href: '/en/privacy' },
        { kind: 'text', text: ' and the ' },
        { kind: 'link', document: 'terms', href: '/en/terms' },
        { kind: 'text', text: '.' },
      ],
    });
  });

  it('drops a table row whose feature is off', () => {
    const input = doc([
      {
        id: 'data',
        heading: 'Data',
        blocks: [
          {
            kind: 'table',
            head: ['What', 'How long'],
            rows: [
              { cells: ['Account', 'Until you delete it.'] },
              {
                cells: ['Backups', '{{backupDays}} days.'],
                when: 'offsiteBackups',
              },
            ],
          },
        ],
      },
    ]);

    const off = renderLegalDocument(
      input,
      settings((base) => ({
        features: { ...base.features, offsiteBackups: false },
      })),
      LINKS
    );
    const on = renderLegalDocument(input, settings(), LINKS);

    const rows = (view: typeof on) =>
      (view.sections[0].blocks[0] as Extract<LegalBlockView, { kind: 'table' }>)
        .rows;
    expect(rows(off)).toHaveLength(1);
    expect(rows(on)).toHaveLength(2);
    expect(rows(on)[1][1]).toEqual([{ kind: 'text', text: '14 days.' }]);
  });

  it('drops a block with a condition that is off, and keeps the rest', () => {
    const view = renderLegalDocument(
      doc([
        {
          id: 'processors',
          heading: 'Who else',
          blocks: [
            paragraph('A hosting company runs our servers.'),
            paragraph('It is {{hostingProvider}}.', 'hostingProvider'),
          ],
        },
      ]),
      settings((base) => ({
        processors: { ...base.processors, hosting: null },
      })),
      LINKS
    );

    expect(view.sections[0].blocks).toHaveLength(1);
  });

  it('names the AI provider from its own table, never the wire value', () => {
    const view = renderLegalDocument(
      doc([
        {
          id: 'assistant',
          heading: 'Assistant',
          blocks: [paragraph('It is {{aiTextProvider}}.', 'aiTextProvider')],
        },
      ]),
      settings(),
      LINKS
    );

    expect(view.sections[0].blocks[0]).toEqual({
      kind: 'paragraph',
      runs: [{ kind: 'text', text: 'It is Anthropic.' }],
    });
  });

  it('never draws a text whose placeholder has no value or is unknown', () => {
    const view = renderLegalDocument(
      doc([
        {
          id: 'x',
          heading: 'X',
          blocks: [
            paragraph('Mail goes through {{emailProvider}}.'),
            paragraph('Unknown {{nobody}}.'),
            paragraph('Unknown [[cookies]].'),
            paragraph('Kept.'),
          ],
        },
      ]),
      settings((base) => ({ processors: { ...base.processors, email: null } })),
      LINKS
    );

    expect(view.sections[0].blocks).toEqual([
      { kind: 'paragraph', runs: [{ kind: 'text', text: 'Kept.' }] },
    ]);
  });
});

describe('legalDocumentProblems', () => {
  it('fails a placeholder that can be empty with no matching when', () => {
    expect(
      legalDocumentProblems(
        doc([
          {
            id: 'processors',
            heading: 'Who else',
            blocks: [paragraph('Mail goes through {{emailProvider}}.')],
          },
        ])
      )
    ).toEqual([
      'section processors block 0: {{emailProvider}} can be empty and needs when: emailProvider',
    ]);
  });

  it('passes the same placeholder behind its when, on the block or the section', () => {
    expect(
      legalDocumentProblems(
        doc([
          {
            id: 'processors',
            heading: 'Who else',
            blocks: [
              paragraph(
                'Mail goes through {{emailProvider}}.',
                'emailProvider'
              ),
            ],
          },
          {
            id: 'backups',
            when: 'offsiteBackups',
            heading: 'Backups',
            blocks: [paragraph('Kept {{backupDays}} days.')],
          },
        ])
      )
    ).toEqual([]);
  });

  it('fails an unknown placeholder, an unknown token and a misspelt one', () => {
    expect(
      legalDocumentProblems(
        doc([
          {
            id: 'x',
            heading: 'X',
            blocks: [
              paragraph('{{nobody}}'),
              paragraph('[[cookies]]'),
              paragraph('{{appName}'),
            ],
          },
        ])
      )
    ).toHaveLength(3);
  });

  it('fails a row with the wrong number of cells and a repeated id', () => {
    expect(
      legalDocumentProblems(
        doc([
          {
            id: 'data',
            heading: 'Data',
            blocks: [
              { kind: 'table', head: ['A', 'B'], rows: [{ cells: ['only'] }] },
            ],
          },
          { id: 'data', heading: 'Again', blocks: [] },
        ])
      )
    ).toHaveLength(2);
  });
});
