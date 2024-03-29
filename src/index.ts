import { Context, Schema, Random, h, Dict, Logger } from 'koishi'
import {} from "@koishijs/plugin-notifier"

export const name = 'random-send'

declare module 'koishi' {
  interface Tables {
    randomMessageData: RandomMessageData
  }
}

export interface RandomMessageData {
  id: number
  message: string
  activeZone: string
}

export interface Config {
  admins: string[]
  guildId: Dict
  globalMessageList: string[]
  minInterval: number
  maxInterval: number
  noRepeat: boolean
  pageLimit: number
  maxRetry: number
  retryInterval: number
  debugMode: boolean
}

export const Config: Schema<Config> = Schema.object({
  admins: Schema.array(Schema.string())
    .description("允许在群内管理随机消息的人，一个项目填一个ID"),
  guildId:Schema.dict(Schema.string())
    .role("table")
    .description("会发送消息的群聊ID，不填写平台名及ID代表该平台所有群，填写平台名不填写频道ID则代表不在该平台发消息\n\n键为平台（平台名以右下角状态栏为准），值为频道ID（频道ID间以半角逗号隔开）"),
  globalMessageList:Schema.array(Schema.string())
    .description("全局随机消息，但不会显示在随机消息列表里"),
  minInterval:Schema.number()
    .description("发送消息的最小间隔（秒）")
    .required(),
  maxInterval:Schema.number()
    .description("发送消息的最大间隔（秒）")
    .required(),
  noRepeat:Schema.boolean()
    .description("是否禁止群内连续两条随机消息相同")
    .default(false),
  pageLimit:Schema.number()
    .description("列表每页显示多少条随机消息")
    .default(5),
  maxRetry:Schema.number()
    .description("发送失败后的最大重试次数")
    .default(5),
  retryInterval: Schema.number()
    .description('发送失败后的重试间隔（毫秒）')
    .default(500),
  debugMode: Schema.boolean()
    .description('发送失败时，在日志显示调用栈')
    .default(false)
})

export const inject = ["database", "notifier"]

export const usage = `
在设定的范围内取随机值间隔，到达后随机抽一个群，在随机消息列表内抽一条消息发送  
随机消息列表可由配置页和指令两种方式添加  
指令添加的方式只有配置页中设置的admin才能操作（删除同样需要）  
指令添加默认只在该群生效（也就是说只有这个群会抽到这个消息）  
添加时加入-g选项，代表添加为全局消息（即所有群都会抽到这个消息）  
随机消息.列表会显示该群以及全局的随机消息（但不包括配置页设置的全局随机消息）  
`

export function apply(ctx: Context, config: Config) {
  const notifier = ctx.notifier.create()
  extendTable(ctx)
  let lastSend = {}

  async function countdown(time:number) {
    for (let i = time; i >= 0; i--) {
      notifier.update(`下一条随机消息将在 ${i} 秒后发送`)
      try {
        await ctx.sleep(1000)
      } catch {
        return
      }
    }
  }

  ctx.on("ready", async () => {
    while(true) {
      let wait = Random.int(config.minInterval, config.maxInterval + 1)
      countdown(wait)
      try {
        await ctx.sleep(wait * 1000)
      } catch {
        return
      }
      for (let bot of ctx.bots) {
        let guilds = config.guildId[bot.platform]
        if (guilds === undefined) {
          let guilds = []
          for await (let guild of bot.getGuildIter()) {
            guilds.push(guild)
          }
          let retry = 0
          while (true) {
            let guildId = Random.pick(guilds).id
            let data = await ctx.database.get("randomMessageData", {$or: [{activeZone: "global"}, {activeZone: guildId}]})
            let superMessageList = config.globalMessageList.concat(data.map((value) => value.message))
            let send: string
            do {
              send = Random.pick([...new Set(superMessageList)])
            } while (send === lastSend[guildId] && config.noRepeat)
            lastSend[guildId] = send
            try {
              await bot.sendMessage(guildId, send)
              break
            } catch (e) {
              try {
                let channels = []
                for await (let channel of bot.getChannelIter(guildId)) {
                  if (channel.type === 0) channels.push(channel)
                }
                let channelId = Random.pick(channels).id
                await bot.sendMessage(channelId, send)
                break
              } catch (e) {
                retry++
                let logger = new Logger('random-send')
                if (retry > config.maxRetry) {
                  logger.warn(`随机消息发送失败（已重试${config.maxRetry}次）：${config.debugMode ? e.stack : e.name + ": " + e.message}`)
                  break
                }
                logger.warn(`随机消息发送失败（已重试${retry-1}/${config.maxRetry}次，将在${config.retryInterval}ms后重试）：${config.debugMode ? e.stack : e.name + ": " + e.message}`)
                
                try {
                  await ctx.sleep(config.retryInterval)
                } catch  {
                  return
                }
                continue
              }
            }
          }
        } else {
          if (guilds === null || guilds.length === 0) continue
          let retry = 0
          while (true) {
            let guildId = Random.pick(guilds.split(","))
            let data = await ctx.database.get("randomMessageData", {$or: [{activeZone: "global"}, {activeZone: guildId}]})
            let superMessageList = config.globalMessageList.concat(data.map((value) => value.message))
            let send: string
            do {
              send = Random.pick([...new Set(superMessageList)])
            } while (send === lastSend[guildId as string] && config.noRepeat)
            lastSend[guildId as string] = send
            try {
              await bot.sendMessage(guildId as string, send)
              break
            } catch (e) { 
              try {
                let channels = []
                for await (let channel of bot.getChannelIter(guildId as string)) {
                  if (channel.type === 0) channels.push(channel)
                }
                let channelId = Random.pick(channels).id
                await bot.sendMessage(channelId, send)
                break
              } catch (e) {
                retry++
                let logger = new Logger('random-send')
                if (retry > config.maxRetry) {
                  logger.warn(`随机消息发送失败（已重试${config.maxRetry}次）：${config.debugMode ? e.stack : e.name + ": " + e.message}`)
                  break
                }
                logger.warn(`随机消息发送失败（已重试${retry-1}/${config.maxRetry}次，将在${config.retryInterval}ms后重试）：${config.debugMode ? e.stack : e.name + ": " + e.message}`)
                try {
                  await ctx.sleep(config.retryInterval)
                } catch {
                  return
                }
                continue
              }
            }
          }
        } 
      }
    }
  })

  ctx.guild().command("随机消息", "控制随机发送的消息")

  ctx.guild().command("随机消息.添加 <message:text>", "添加随机消息").alias("添加随机消息")
    .option("global", "-g 添加为全局")
    .usage("注意！选项必须放在参数前面，否则会被当做参数的一部分！")
    .example("随机消息.添加 -g koishi是koishi的koishi")
    .action(async ({session, options}, message) => {
      if (config.admins.includes(session.event.user.id)) {
        let id
        if (options.global) {
          if (config.globalMessageList.includes(message) || (await ctx.database.get("randomMessageData", {activeZone: "global", message: message})).length > 0) {
            return h("quote", {id: session.event.message.id}) + "已存在于全局随机消息"
          }
          id = (await ctx.database.create("randomMessageData", {message: message, activeZone: "global"})).id
        } else if ((await ctx.database.get("randomMessageData", {activeZone: session.event.channel.id, message: message})).length > 0) {
          return h("quote", {id: session.event.message.id}) + "已存在于本群随机消息"
        } else {
          id = (await ctx.database.create("randomMessageData", {message: message, activeZone: session.event.channel.id})).id
        }
        return h("quote", {id: session.event.message.id}) + "添加成功，编号为：" + id
      }
      return h("quote", {id: session.event.message.id}) + "你没有权限"
    })

  ctx.guild().command("随机消息.删除 <id:posint>", "删除随机消息").alias("删除随机消息")
    .usage("id是随机消息的编号")
    .action(async ({session}, id) => {
      if (config.admins.includes(session.event.user.id)) {
        let data = await ctx.database.get("randomMessageData", {id: id})
        if (data.length !== 0) {
          await ctx.database.remove("randomMessageData", {id: id})
          return h("quote", {id: session.event.message.id}) + `编号：${id}
内容：${data[0].message}
生效频道：${data[0].activeZone === "global" ? "全局" : session.event.channel.id}
删除成功`
        }
        return h("quote", {id: session.event.message.id}) + "编号不存在"
      }
    })

  ctx.guild().command("随机消息.列表 <page:posint>", "查看随机消息列表").alias("随机消息列表")
    .usage("page是页码")
    .action(async ({session}, page) => {
      let data = await ctx.database.get("randomMessageData", {$or: [{activeZone: "global"}, {activeZone: session.event.channel.id}]})
      let dataPaged = await ctx.database
        .select("randomMessageData")
        .where({$or: [{activeZone: "global"}, {activeZone: session.event.channel.id}]})
        .limit(config.pageLimit)
        .offset((page - 1) * config.pageLimit)
        .orderBy("id", "desc")
        .execute()
      if (dataPaged.length === 0) {
        if (data.length === 0) {
          return h("quote", {id: session.event.message.id}) + "本频道没有生效的随机消息"
        }
        return h("quote", {id: session.event.message.id}) + "该分页为空"
      }
      let result = `${h("quote", {id: session.event.message.id})}\n`
      for (let i of dataPaged) {
        result += `[${i.activeZone === "global" ? "全局" : "本群"}]编号${i.id}：${i.message}
`
      }
      result += `\n第${page ?? 1}/${Math.ceil(data.length / config.pageLimit)}页`
      return result
    })
}

async function extendTable(ctx) {
  await ctx.model.extend("randomMessageData", {
    id: "unsigned",
    message: "text",
    activeZone: "text"
  }, {autoInc: true, primary: "id"})
}