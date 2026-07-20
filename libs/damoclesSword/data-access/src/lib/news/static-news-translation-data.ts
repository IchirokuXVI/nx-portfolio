import { NewsTranslation } from './news';

/**
 * Per-locale news text. The real endpoint will return already-localized copy
 * (the client can't translate an unknown server response ahead of time), so the
 * mock keeps the translated strings here rather than as i18n keys.
 */
export const NEWS_TRANSLATIONS: readonly NewsTranslation[] = [
  // Ready to try out Starlit VS?
  {
    id: '1',
    newsId: '1',
    locale: 'en',
    title: 'Ready to try out Starlit VS?',
    description:
      "On June 5th, the Match In Games fair will take place at UDIT, where we will showcase a demo of our highly anticipated game, Starlit VS. \n\nWe hope to see all our fans there, and don't forget to vote for us as Best Game! 7w7",
  },
  {
    id: '2',
    newsId: '1',
    locale: 'es',
    title: '¿Listo para probar Starlit VS?',
    description:
      'El 5 de junio se celebrará la feria Match In Games en UDIT, donde mostraremos una demo de nuestro esperadísimo juego, Starlit VS. \n\n¡Esperamos veros a todos allí, y no olvidéis votarnos como Mejor Juego! 7w7',
  },
  {
    id: '3',
    newsId: '1',
    locale: 'fr',
    title: 'Prêt à essayer Starlit VS ?',
    description:
      "Le 5 juin, le salon Match In Games se tiendra à UDIT, où nous présenterons une démo de notre jeu très attendu, Starlit VS. \n\nNous espérons vous y voir tous, et n'oubliez pas de voter pour nous comme Meilleur Jeu ! 7w7",
  },

  // Winners at Game Jam Madrid Crea
  {
    id: '4',
    newsId: '2',
    locale: 'en',
    title: 'Winners at Game Jam Madrid Crea - 6th Edition',
    description:
      'We managed to win the Game Jam! \n\nAlong with 7 other games, we were showcased on February 6th at the Bank of Spain (Madrid). It was a one-of-a-kind event.',
  },
  {
    id: '5',
    newsId: '2',
    locale: 'es',
    title: 'Ganadores en la Game Jam Madrid Crea - 6ª Edición',
    description:
      '¡Conseguimos ganar la Game Jam! \n\nJunto a otros 7 juegos, fuimos expuestos el 6 de febrero en el Banco de España (Madrid). Fue un evento único.',
  },
  {
    id: '6',
    newsId: '2',
    locale: 'fr',
    title: 'Gagnants à la Game Jam Madrid Crea - 6ème Édition',
    description:
      "Nous avons réussi à gagner la Game Jam ! \n\nAvec 7 autres jeux, nous avons été présentés le 6 février à la Banque d'Espagne (Madrid). Ce fut un événement unique en son genre.",
  },
];
