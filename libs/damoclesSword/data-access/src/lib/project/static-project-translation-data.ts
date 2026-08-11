import { ProjectTranslation } from './project';

/**
 * Per-locale project descriptions. Kept here — already translated — rather than
 * as i18n keys resolved by the UI: the UI renders the copy directly for the active locale.
 */
export const PROJECT_TRANSLATIONS: readonly ProjectTranslation[] = [
  // VR Sickness Reducer
  {
    id: '1',
    projectId: '1',
    locale: 'en',
    description:
      'A test designed to reduce dizziness caused by exposure to virtual reality environments, consisting of 5 phases where the level of dizziness intensity is gradually increased. \n\nProgressive intensity helps the user adapt better to the inputs that make them dizzy, making this project a training program that reduces dizziness through controlled progressive exposure.',
  },
  {
    id: '2',
    projectId: '1',
    locale: 'es',
    description:
      'Una prueba diseñada para reducir los mareos provocados por la exposición a entornos de realidad virtual que consta de 5 fases donde poco a poco se sube el nivel de intensidad de mareo. \n\nLa intensidad progresiva ayuda al usuario a una mejor adaptación a los inputs que le hacen marearse, haciendo de éste proyecto un entrenamiento que consigue reducir los mareos mediante la exposición progresiva controlada.',
  },
  {
    id: '3',
    projectId: '1',
    locale: 'fr',
    description:
      "Un test conçu pour réduire les vertiges causés par l'exposition à des environnements de réalité virtuelle, composé de 5 phases où le niveau d'intensité des vertiges est progressivement augmenté. \n\nL'intensité progressive aide l'utilisateur à mieux s'adapter aux entrées qui le font tourner la tête, faisant de ce projet un programme d'entraînement qui réduit les vertiges grâce à une exposition progressive contrôlée.",
  },

  // Realistic Interactor
  {
    id: '4',
    projectId: '2',
    locale: 'en',
    description:
      'A simulator that tests realism in virtual environments, both in terms of graphics and interactions with the generated environment. \n\nThis project is an ongoing experiment that strives for pure realism. It serves as a showcase of our development and design capabilities within the industry, allowing our clients to observe and envision the types of features our projects could have.',
  },
  {
    id: '5',
    projectId: '2',
    locale: 'es',
    description:
      'Un simulador que pone a prueba el realismo en entornos virtuales, tanto a nivel gráfico como en las interacciones con el entorno generado. \n\nEste proyecto es un experimento en curso que persigue el realismo puro. Sirve como muestra de nuestras capacidades de desarrollo y diseño dentro de la industria, permitiendo a nuestros clientes observar e imaginar el tipo de funcionalidades que podrían tener sus proyectos.',
  },
  {
    id: '6',
    projectId: '2',
    locale: 'fr',
    description:
      "Un simulateur qui teste le réalisme dans des environnements virtuels, tant au niveau graphique que dans les interactions avec l'environnement généré. \n\nCe projet est une expérience en cours qui vise un réalisme pur. Il sert de vitrine de nos capacités de développement et de conception au sein de l'industrie, permettant à nos clients d'observer et d'imaginer le type de fonctionnalités que leurs projets pourraient avoir.",
  },

  // STARLIT: ASCENSION
  {
    id: '7',
    projectId: '3',
    locale: 'en',
    description:
      'Starlit: Ascension is a VR Shooter with a Catholic-futuristic setting, where you will be the test subject for an advanced experiment on the association of consciousness. \n\nIn a world dominated by religion and technological advancement, you will be a subject with no memories who must piece together their past while facing numerous combat trials where you will annihilate alien beasts unleashed by a mysterious compound... Will you be able to survive and remember who you truly are?',
  },
  {
    id: '8',
    projectId: '3',
    locale: 'es',
    description:
      'Starlit: Ascension es un VR Shooter con una ambientación católico-futurista, donde serás el sujeto de pruebas de un experimento avanzado sobre la asociación de la conciencia. \n\nEn un mundo dominado por la religión y el avance tecnológico, serás un sujeto sin recuerdos que deberá reconstruir su pasado mientras se enfrenta a numerosas pruebas de combate en las que aniquilará bestias alienígenas liberadas por un misterioso compuesto... ¿Serás capaz de sobrevivir y recordar quién eres realmente?',
  },
  {
    id: '9',
    projectId: '3',
    locale: 'fr',
    description:
      "Starlit: Ascension est un VR Shooter à l'ambiance catholico-futuriste, où vous serez le sujet de test d'une expérience avancée sur l'association de la conscience. \n\nDans un monde dominé par la religion et le progrès technologique, vous serez un sujet sans souvenirs qui devra reconstituer son passé tout en affrontant de nombreuses épreuves de combat au cours desquelles vous anéantirez des bêtes extraterrestres libérées par un mystérieux composé... Serez-vous capable de survivre et de vous souvenir de qui vous êtes vraiment ?",
  },
];
