/** Tiendas y tiendas de regalos cobran de una vez; en Pedidos ven lo vendido en el día. */
export const cobraDeUna = (negocio) => ["TIENDA", "REGALOS"].includes(negocio?.tipo);
