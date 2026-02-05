# TODO
- Aprovechando los datos de la base de datos, añade todo lo que puedas en el json junto a los hashes de las cartas y muéstralo en el front con la carta detectada, tendrás que modificar como se genera el json de los hashes en el scraper, asegúrate de no tocar nada más que la funcionalidad de los hashes, en caso de ser necesario dímelo

- Estos datos están mal en la web creo:
  const domainStyle = DOMAIN_COLORS[cardData.domain] || DOMAIN_COLORS.Fury;
  const rarityStyle = RARITY_STYLES[cardData.rarity] || RARITY_STYLES.Common;

- Mejorar diseño del front:
    - Se podría poner la columna de abajo a la derecha cuando estoy en ordenador y aprovechar mejor el espacio y la visualización de todo.
    - la cinta de opciones de la parte inferior tapa lo que hay por detrás.
    - Al detectar cartas sale el numero de cartas que hay encima del icono de la cámara en la cinta de opciones, haz que se vea de forma general para la pestaña de escaner y la de añadir foto y si no es posible quítalo, pero que no se vea solo en la pestaña de escaner
    - Si está por debajo del 90% que se vea en amarillo y si está por debajo del 85% que se vea en rojo, para que se vea mejor el porcentaje de confianza del modelo, ahora mismo es difícil de ver y no se ve tan claro cuando el modelo no está seguro de lo que ha detectado

- Se ve más desplazado verticalmente que los demás

- Explicar en el README que se podrían usar imágenes de cartas modificadas con photoshop de manera que el sistema pueda reconocerlas también así a modo de curiosidad

- Investigar de que manera saca la posición de las cartas para la fase de validación del modelo, igual se pueden sacar más parámetros como deformación para mejorar la precisión del modelo

- Probar a cuantizar el modelo para ver si se comporta mejor en dispositivos móviles
