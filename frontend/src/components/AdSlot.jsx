// Контейнер рекламного места: SDK Яндекс.Reкламы кладёт креатив внутрь элемента
// с этим id. Свой текст внутрь класть нельзя — он остался бы рядом с креативом,
// а пустой контейнер скрыт правилом .ad-slot:empty, поэтому невыданное место не
// выглядит сломанным блоком и не отнимает место у контента.
export default function AdSlot({ id, className }) {
  return <div id={id} className={`ad-slot ${className}`} role="complementary" aria-label="Реклама" />;
}
