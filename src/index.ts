import { Context, Schema, sleep, Random } from 'koishi'

export const name = 'random-send'

export interface Config {
  messageList: string[]
  minInterval: number
  maxInterval: number
}

export const Config: Schema<Config> = Schema.object({
  messageList:Schema.array(Schema.string())
    .description("随机发送其中的一条消息")
    .required(),
  minInterval:Schema.number()
    .description("发送消息的最小间隔（秒）")
    .required(),
  maxInterval:Schema.number()
    .description("发送消息的最大间隔（秒）")
    .required()
})

export function apply(ctx: Context, config: Config) {
  let flag = false
  ctx.on("ready", async () => {
    while(true) {
      await sleep(Random.int(config.minInterval * 1000, config.maxInterval * 1000 + 1))
      if (flag) break
      for (let bot of ctx.bots) {
        let guilds = []
        for await (let guild of bot.getGuildIter()) {
          guilds.push(guild)
        }
        let guildId = Random.pick(guilds).id
        await bot.sendMessage(guildId, Random.pick(config.messageList))
      }
    }
  })

  ctx.on("dispose", async () => {
    flag = true
  })
}
