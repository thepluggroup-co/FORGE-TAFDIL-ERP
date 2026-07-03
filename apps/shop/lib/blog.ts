export interface BlogArticle {
  slug: string
  category: string
  title: string
  excerpt: string
  date: string
  readTime: string
  author: string
  image: string
  tags: string[]
  sections: Array<{
    title: string
    paragraphs: string[]
    bullets?: string[]
  }>
  expertTip?: {
    title: string
    text: string
  }
}

export const blogArticles: BlogArticle[] = [
  {
    slug: 'comment-bien-choisir-ses-profils-aluminium-pour-vos-menuiseries',
    category: 'Conseils',
    title: 'Comment bien choisir ses profils aluminium pour vos menuiseries',
    excerpt: 'Les criteres essentiels pour choisir des profils durables, esthetiques et adaptes a chaque projet.',
    date: '12 Mai 2026',
    readTime: '5 min de lecture',
    author: 'Jean-Pierre M.',
    image: 'https://images.unsplash.com/photo-1564540583246-934409427776?auto=format&fit=crop&w=1400&q=80',
    tags: ['Aluminium', 'Menuiserie', 'Construction', 'Profils', 'Conseils'],
    expertTip: {
      title: 'Conseil d expert',
      text: 'Pour une meilleure efficacite energetique, privilegiez les profils a rupture de pont thermique.',
    },
    sections: [
      {
        title: 'Comprendre les differents types de profils aluminium',
        paragraphs: ['Il existe plusieurs types de profils aluminium adaptes a differents usages. Le bon choix depend du lieu de pose, des dimensions, de l exposition et du niveau de resistance attendu.'],
        bullets: [
          'Profils a rupture de pont thermique : ideales pour l isolation thermique et acoustique.',
          'Profils standards : parfaits pour les applications interieures ou les environnements temperes.',
          'Profils renforces : concus pour les grandes dimensions et les charges elevees.',
        ],
      },
      {
        title: 'Les criteres de choix essentiels',
        paragraphs: ['Pour choisir le bon profil aluminium, prenez en compte l isolation, la resistance mecanique, l esthetique, la facilite de pose, la conformite aux normes et le budget disponible.'],
      },
      {
        title: 'Les finitions et traitements disponibles',
        paragraphs: ['Les profils aluminium peuvent etre personnalises grace a differents traitements afin de renforcer leur durabilite et leur rendu visuel.'],
        bullets: [
          'Anodisation : protege contre la corrosion et ameliore la durabilite.',
          'Thermolaquage : offre une large gamme de couleurs et une excellente resistance.',
          'Effet bois : apporte une esthetique naturelle et chaleureuse.',
        ],
      },
      {
        title: 'Pourquoi choisir MetalForge ?',
        paragraphs: ['Chez MetalForge, nous proposons des profils aluminium de haute qualite, certifies et adaptes a tous vos projets. Nos experts accompagnent les particuliers et professionnels dans le choix des materiaux les plus fiables.'],
      },
    ],
  },
  {
    slug: 'entretien-et-protection-des-structures-metalliques-nos-astuces',
    category: 'Guide',
    title: 'Entretien et protection des structures metalliques : nos astuces',
    excerpt: 'Les bonnes pratiques pour proteger portails, grilles et charpentes contre la corrosion.',
    date: '05 Mai 2026',
    readTime: '4 min de lecture',
    author: 'David K.',
    image: 'https://images.unsplash.com/photo-1518709268805-4e9042af2176?auto=format&fit=crop&w=1400&q=80',
    tags: ['Ferronnerie', 'Protection', 'Entretien', 'Antirouille'],
    expertTip: {
      title: 'Bon reflexe chantier',
      text: 'Inspectez les points de soudure et les zones exposees a l eau avant chaque saison des pluies.',
    },
    sections: [
      {
        title: 'Nettoyer avant de proteger',
        paragraphs: ['Une structure metallique doit toujours etre degraissée, depoussieree et seche avant l application d un traitement. Cette preparation conditionne l adherence de la peinture et la duree de protection.'],
      },
      {
        title: 'Choisir un traitement adapte',
        paragraphs: ['Le choix du traitement depend de l usage et de l exposition. Un portail exterieur demande une protection plus robuste qu une piece installee en interieur.'],
        bullets: [
          'Primaire antirouille pour bloquer l oxydation.',
          'Peinture de finition pour proteger et uniformiser l aspect.',
          'Galvanisation pour les structures fortement exposees.',
        ],
      },
      {
        title: 'Planifier l entretien',
        paragraphs: ['Un controle visuel regulier permet de traiter rapidement les impacts, rayures et departs de rouille. Une intervention rapide evite les reparations lourdes.'],
      },
    ],
  },
  {
    slug: 'les-avantages-de-laluminium-dans-la-construction-moderne',
    category: 'Actualites',
    title: 'Les avantages de l aluminium dans la construction moderne',
    excerpt: 'Pourquoi l aluminium s impose dans les facades, menuiseries et amenagements contemporains.',
    date: '28 Avr. 2026',
    readTime: '6 min de lecture',
    author: 'Patrick A.',
    image: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1400&q=80',
    tags: ['Aluminium', 'Construction', 'Facade', 'Architecture'],
    expertTip: {
      title: 'A retenir',
      text: 'L aluminium reduit les contraintes de maintenance tout en offrant une grande liberte de conception.',
    },
    sections: [
      {
        title: 'Un materiau leger et resistant',
        paragraphs: ['L aluminium combine legerete, rigidite et resistance a la corrosion. Il facilite la pose, reduit les charges sur les structures et convient aux projets modernes de toutes tailles.'],
      },
      {
        title: 'Une excellente durabilite',
        paragraphs: ['Avec un traitement adapte, l aluminium conserve ses performances et son aspect pendant de longues annees, meme en environnement humide ou urbain.'],
      },
      {
        title: 'Un rendu esthetique contemporain',
        paragraphs: ['Ses finitions variees permettent de realiser des menuiseries fines, des facades elegantes et des ensembles parfaitement integres a l architecture du batiment.'],
        bullets: [
          'Large choix de couleurs.',
          'Profils fins pour maximiser la lumiere.',
          'Compatibilite avec vitrages performants.',
        ],
      },
    ],
  },
]

export function getArticleBySlug(slug: string) {
  return blogArticles.find((article) => article.slug === slug) ?? null
}
