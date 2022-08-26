const BlogDate = ({ date }) => {
  let format = new Intl.DateTimeFormat("cn", {
    year: "numeric",
    month: "long",
    day: "numeric"
  })

  let dateParts = format.formatToParts(new Date(date))

  return <>{dateParts.map(it => it.value).join("")}</>
}

export default BlogDate
