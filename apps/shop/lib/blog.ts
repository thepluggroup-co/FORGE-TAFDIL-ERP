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
    image: 'https://images.unsplash.com/photo-1487958449943-2429e8be8625?auto=format&fit=crop&w=1400&q=80',
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
        title: 'Pourquoi choisir TAFDIL ?',
        paragraphs: ['Chez TAFDIL, nous proposons des profils aluminium de haute qualite, certifies et adaptes a tous vos projets. Nos experts accompagnent les particuliers et professionnels dans le choix des materiaux les plus fiables.'],
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
    image: 'https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=1400&q=80',
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
  {
    slug: 'portails-en-fer-forge-ou-aluminium-lequel-choisir',
    category: 'Conseils',
    title: 'Portails en fer forge ou aluminium : lequel choisir ?',
    excerpt: 'Comparatif complet pour choisir le materiau le plus adapte a votre securite, votre style et votre budget.',
    date: '20 Avr. 2026',
    readTime: '5 min de lecture',
    author: 'Jean-Pierre M.',
    image: 'https://images.unsplash.com/photo-1600607686527-6fb886090705?auto=format&fit=crop&w=1400&q=80',
    tags: ['Portail', 'Fer forge', 'Aluminium', 'Securite', 'Exterieur'],
    expertTip: {
      title: 'Choix terrain',
      text: 'Pour une zone humide ou tres exposee, l aluminium thermolaque limite fortement les contraintes d entretien.',
    },
    sections: [
      {
        title: 'Comparer la resistance et l entretien',
        paragraphs: ['Le fer forge reste une reference pour les portails tres robustes et decoratifs, mais il demande un entretien regulier contre la corrosion. L aluminium est plus leger, ne rouille pas et conserve une bonne tenue dans le temps avec une finition adaptee.'],
        bullets: [
          'Fer forge : ideal pour les styles classiques, les formes travaillees et les portails lourds.',
          'Aluminium : recommande pour les projets modernes, les ouvertures motorisees et les environnements humides.',
          'Acier traite : bon compromis lorsque la priorite est la resistance mecanique.',
        ],
      },
      {
        title: 'Tenir compte du style architectural',
        paragraphs: ['Le choix doit s integrer a la facade, a la cloture et au niveau de visibilite souhaite. Un portail ajoure apporte de la legerete visuelle, tandis qu un modele plein renforce l intimite et la securite.'],
      },
      {
        title: 'Evaluer le budget global',
        paragraphs: ['Le prix ne se limite pas au materiau. Il faut aussi compter la pose, la motorisation, les traitements de protection, la quincaillerie et l entretien sur plusieurs annees.'],
      },
    ],
  },
  {
    slug: 'tout-savoir-sur-la-visserie-inoxydable-types-usages-et-avantages',
    category: 'Guide',
    title: 'Tout savoir sur la visserie inoxydable : types, usages et avantages',
    excerpt: 'La visserie inoxydable est essentielle pour garantir solidite, proprete et resistance a la corrosion.',
    date: '15 Avr. 2026',
    readTime: '7 min de lecture',
    author: 'David K.',
    image: 'https://images.unsplash.com/photo-1586864387789-628af9feed72?auto=format&fit=crop&w=1400&q=80',
    tags: ['Visserie', 'Inox', 'Fixation', 'Assemblage', 'Chantier'],
    expertTip: {
      title: 'Point technique',
      text: 'En exterieur, privilegiez une visserie inox A2 ou A4 selon l exposition a l humidite et aux produits corrosifs.',
    },
    sections: [
      {
        title: 'Identifier les principales familles de visserie',
        paragraphs: ['Chaque assemblage exige une fixation adaptee. Les vis, boulons, rondelles et ecrous n ont pas le meme role et doivent etre choisis selon la charge, le support et l environnement.'],
        bullets: [
          'Vis inox : pratiques pour les assemblages rapides sur supports metalliques ou bois.',
          'Boulons inox : adaptes aux assemblages demontables et aux charges plus elevees.',
          'Rondelles : utiles pour repartir l effort et proteger les surfaces.',
        ],
      },
      {
        title: 'Choisir le bon inox',
        paragraphs: ['L inox A2 convient a de nombreux usages courants, tandis que l inox A4 est plus resistant en milieux agressifs. Ce choix influence directement la duree de vie de l installation.'],
      },
      {
        title: 'Eviter les erreurs de pose',
        paragraphs: ['Un serrage excessif, un diametre mal choisi ou un melange de metaux incompatible peut fragiliser l assemblage. Il est preferable de verifier les charges et les contraintes avant la pose.'],
      },
    ],
  },
  {
    slug: 'tendances-2026-en-metallerie-design-technologie-et-innovation',
    category: 'Tendances',
    title: 'Tendances 2026 en metallerie : design, technologie et innovation',
    excerpt: 'Les nouvelles tendances qui faconnent l avenir de la metallerie et de la construction metallique.',
    date: '10 Avr. 2026',
    readTime: '5 min de lecture',
    author: 'Patrick A.',
    image: 'https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?auto=format&fit=crop&w=1400&q=80',
    tags: ['Tendances', 'Metallerie', 'Innovation', 'Design', 'Construction'],
    expertTip: {
      title: 'A surveiller',
      text: 'Les projets les plus performants combinent aujourd hui conception 3D, prefabrication et traitements de surface durables.',
    },
    sections: [
      {
        title: 'Des lignes plus fines et plus techniques',
        paragraphs: ['Les architectes recherchent des structures metalliques plus legeres visuellement, capables de conserver une grande resistance. Les profils fins, les assemblages discrets et les finitions mates gagnent du terrain.'],
      },
      {
        title: 'Une fabrication plus precise',
        paragraphs: ['La decoupe numerique, la modelisation 3D et la prefabrication permettent de limiter les erreurs sur chantier et de raccourcir les delais de pose.'],
        bullets: [
          'Meilleure anticipation des contraintes techniques.',
          'Moins de reprises sur chantier.',
          'Finitions plus regulieres et plus professionnelles.',
        ],
      },
      {
        title: 'Des materiaux plus durables',
        paragraphs: ['La demande se renforce pour les traitements anticorrosion, les peintures haute resistance et les solutions recyclables. La durabilite devient un argument central pour les clients professionnels comme particuliers.'],
      },
    ],
  },
  {
    slug: 'normes-et-reglementations-ce-quil-faut-savoir-avant-de-construire',
    category: 'Actualites',
    title: 'Normes et reglementations : ce qu il faut savoir avant de construire',
    excerpt: 'Les points de vigilance pour garantir la securite, la conformite et la durabilite de vos structures metalliques.',
    date: '02 Avr. 2026',
    readTime: '4 min de lecture',
    author: 'Jean-Pierre M.',
    image: 'https://images.unsplash.com/photo-1485083269755-a7b559a4fe5e?auto=format&fit=crop&w=1400&q=80',
    tags: ['Normes', 'Reglementation', 'Securite', 'Construction', 'Controle'],
    expertTip: {
      title: 'Avant devis',
      text: 'Rassemblez les plans, dimensions, contraintes du site et usages prevus avant de valider une solution technique.',
    },
    sections: [
      {
        title: 'Clarifier l usage de la structure',
        paragraphs: ['Une charpente, une mezzanine, un garde-corps ou un portail ne repondent pas aux memes contraintes. L usage determine les charges, les dimensions, les fixations et les protections a prevoir.'],
      },
      {
        title: 'Verifier les exigences de securite',
        paragraphs: ['La securite concerne autant la conception que la fabrication et la pose. Les points sensibles sont les soudures, les ancrages, les garde-corps, les hauteurs, les passages et la resistance aux efforts.'],
        bullets: [
          'Controler les points d ancrage avant fabrication.',
          'Prevoir une protection contre la corrosion.',
          'Documenter les dimensions et les charges attendues.',
        ],
      },
      {
        title: 'Travailler avec un fournisseur competent',
        paragraphs: ['Un accompagnement technique permet d eviter les choix approximatifs et les reprises couteuses. TAFDIL aide a selectionner les materiaux et les solutions adaptees a chaque projet.'],
      },
    ],
  },
]

export function getArticleBySlug(slug: string) {
  return blogArticles.find((article) => article.slug === slug) ?? null
}
