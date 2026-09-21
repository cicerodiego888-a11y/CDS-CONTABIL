# Plano de Contas

O importador preserva Código, Classificação e Descrição (e Tipo S/A quando o arquivo trouxer). Tipo S representa conta sintética/grupo; Tipo A representa conta analítica/postável. Na Relação de Contas sem coluna de tipo, S/A é inferido pela hierarquia da classificação. **Classificação não é chave única.** O sistema mantém source_id e raw_data para rastreabilidade. Duplicidade exata exige o mesmo código, classificação e descrição.
